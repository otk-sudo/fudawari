// 公開の前の確認に出す警告（UI／UX の指摘 中8）のテスト
import { describe, expect, it } from "vitest";
import { summer2026Definition } from "@/test/fixtures";
import * as definitionEdit from "./index";
import { findPublishWarnings, isEmptyBoostGroup } from "./publish-warnings";
import { editDoc, fudaOf, stageOf } from "./test-helpers";

const def = summer2026Definition;

/** テスト用の定義に出てくる艦名すべて（艦船マスタにある艦名として渡す） */
const ALL_SHIP_NAMES: ReadonlySet<string> = new Set(
  def.stages.flatMap((stage) => stage.boosts.flatMap((group) => [...group.shipNames])),
);

describe("isEmptyBoostGroup（空の特効グループか）", () => {
  it("名前なし・倍率 1・艦名なし・国籍なしなら空", () => {
    expect(isEmptyBoostGroup({ id: "x", name: "", multiplier: 1, shipNames: [] })).toBe(true);
  });

  it("名前が空白だけでも空として扱う", () => {
    expect(isEmptyBoostGroup({ id: "x", name: "  ", multiplier: 1, shipNames: [] })).toBe(true);
  });

  it("名前・倍率・艦名・国籍のどれかがあれば空でない", () => {
    expect(isEmptyBoostGroup({ id: "x", name: "A", multiplier: 1, shipNames: [] })).toBe(false);
    expect(isEmptyBoostGroup({ id: "x", name: "", multiplier: 1.2, shipNames: [] })).toBe(false);
    expect(isEmptyBoostGroup({ id: "x", name: "", multiplier: 1, shipNames: ["雪風"] })).toBe(false);
    expect(isEmptyBoostGroup({ id: "x", name: "", multiplier: 1, shipNames: [], nationalities: ["usa"] })).toBe(false);
  });
});

describe("findPublishWarnings（公開の前の警告）", () => {
  it("空の特効グループなし・札番号はすべて入力済み・艦名はすべてマスタにあれば、警告なし", () => {
    expect(findPublishWarnings(def, ALL_SHIP_NAMES)).toEqual([]);
  });

  it("空の特効グループがあれば、段階名（海域名＋段階名）とともに警告する（選んでいるかに関わらず文書全体から）", () => {
    const doc = editDoc(def, (draft) => {
      stageOf(draft, "E3-G").boosts.push({ id: "E3-G-X", name: "", multiplier: 1, shipNames: [] });
    });

    const warnings = findPublishWarnings(doc, ALL_SHIP_NAMES);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("empty_boost_groups");
    expect(warnings[0]?.message).toContain("空の特効グループ");
    expect(warnings[0]?.message).toContain("「E3 ギミック」");
  });

  it("同じ段階に空の特効グループが 2 つあれば、1 件の警告に数を書く", () => {
    const doc = editDoc(def, (draft) => {
      const boosts = stageOf(draft, "E3-G").boosts;
      boosts.push({ id: "E3-G-X", name: "", multiplier: 1, shipNames: [] });
      boosts.push({ id: "E3-G-Y", name: "", multiplier: 1, shipNames: [] });
    });

    const warnings = findPublishWarnings(doc, ALL_SHIP_NAMES);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("2 つ");
  });

  it("国籍だけの特効グループ（名前なし・艦名なし・アメリカ ×1.2）は空として警告しない", () => {
    const doc = editDoc(def, (draft) => {
      stageOf(draft, "E3-G").boosts.push({
        id: "E3-G-U",
        name: "",
        multiplier: 1.2,
        shipNames: [],
        nationalities: ["usa"],
      });
    });

    expect(findPublishWarnings(doc, ALL_SHIP_NAMES)).toEqual([]);
  });

  it("ゲーム内の札番号が未入力の札があれば、札名と、差分の対象外になることを札ごとに警告する", () => {
    const doc = editDoc(def, (draft) => {
      fudaOf(draft, "tago").gameNumber = null;
      fudaOf(draft, "sixth").gameNumber = null;
    });

    const warnings = findPublishWarnings(doc, ALL_SHIP_NAMES);

    expect(warnings.map((w) => w.code)).toEqual(["missing_game_number", "missing_game_number"]);
    expect(warnings[0]?.message).toContain("「多号作戦部隊」");
    expect(warnings[0]?.message).toContain("札番号");
    expect(warnings[0]?.message).toContain("差分");
    expect(warnings[1]?.message).toContain("「第六艦隊」");
  });

  it("艦船マスタにない艦名を、出てきた順・重複なしで 1 件にまとめて警告する", () => {
    const known = new Set([...ALL_SHIP_NAMES].filter((name) => name !== "千代田" && name !== "冬月"));

    const warnings = findPublishWarnings(def, known);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("unknown_ship_names");
    expect(warnings[0]?.message).toContain("艦船マスタにない艦名");
    expect(warnings[0]?.message).toMatch(/冬月、千代田/);
  });

  it("艦船マスタの艦名を渡さなければ、艦名は見ない", () => {
    expect(findPublishWarnings(def)).toEqual([]);
  });

  it("警告は 特効グループ → 札 → 艦名 の順に並べる", () => {
    const doc = editDoc(def, (draft) => {
      fudaOf(draft, "tago").gameNumber = null;
      stageOf(draft, "E3-G").boosts.push({ id: "E3-G-X", name: "", multiplier: 1, shipNames: [] });
    });

    const warnings = findPublishWarnings(doc, new Set<string>());

    expect(warnings.map((w) => w.code)).toEqual(["empty_boost_groups", "missing_game_number", "unknown_ship_names"]);
  });

  it("入口（@/domain/definition-edit）から使える", () => {
    expect(definitionEdit.findPublishWarnings).toBe(findPublishWarnings);
  });

  // PR #44 の独立レビュー（親の決定）
  describe("効く艦がない特効グループ（名前・倍率はあるが、艦名も国籍もない）", () => {
    it("空の特効グループとは別の文（「効く艦がない特効グループ」と段階名）で警告する", () => {
      const doc = editDoc(def, (draft) => {
        stageOf(draft, "E3-G").boosts.push({ id: "E3-G-N", name: "米艦", multiplier: 1.2, shipNames: [] });
      });

      const warnings = findPublishWarnings(doc, ALL_SHIP_NAMES);

      expect(warnings.map((w) => w.code)).toEqual(["no_target_boost_groups"]);
      expect(warnings[0]?.message).toContain("効く艦がない特効グループ");
      expect(warnings[0]?.message).toContain("「E3 ギミック」");
      expect(warnings[0]?.message).not.toContain("空の特効グループ");
    });

    it("空の特効グループはこれまでどおり空として警告し、効く艦がないグループとしては数えない。並びは 空 → 効く艦がない → 札", () => {
      const doc = editDoc(def, (draft) => {
        stageOf(draft, "E3-G").boosts.push({ id: "E3-G-X", name: "", multiplier: 1, shipNames: [] });
        stageOf(draft, "E3-G").boosts.push({ id: "E3-G-N", name: "", multiplier: 1.2, shipNames: [] });
        fudaOf(draft, "tago").gameNumber = null;
      });

      const warnings = findPublishWarnings(doc, ALL_SHIP_NAMES);

      expect(warnings.map((w) => w.code)).toEqual(["empty_boost_groups", "no_target_boost_groups", "missing_game_number"]);
    });
  });

  describe("警告の見分け方（同じ名前の段階・札）", () => {
    it("警告ごとに重複しない id を持つ", () => {
      const doc = editDoc(def, (draft) => {
        stageOf(draft, "E3-G").boosts.push({ id: "E3-G-X", name: "", multiplier: 1, shipNames: [] });
        stageOf(draft, "E2-G").boosts.push({ id: "E2-G-X", name: "", multiplier: 1, shipNames: [] });
        fudaOf(draft, "tago").gameNumber = null;
        fudaOf(draft, "sixth").gameNumber = null;
      });

      const ids = findPublishWarnings(doc, new Set<string>()).map((w) => w.id);

      expect(new Set(ids).size).toBe(ids.length);
    });

    it("同じ表示名の段階（E2 の 2・3 番目がどちらも「新しい段階」）は、海域の中の位置を添えて見分けられる文にする", () => {
      const doc = editDoc(def, (draft) => {
        for (const id of ["E2-1", "E2-2"]) {
          const stage = stageOf(draft, id);
          stage.name = "新しい段階";
          stage.boosts.push({ id: `${id}-X`, name: "", multiplier: 1, shipNames: [] });
        }
      });

      const messages = findPublishWarnings(doc, ALL_SHIP_NAMES).map((w) => w.message);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain("E2 の 2 番目の段階「新しい段階」");
      expect(messages[1]).toContain("E2 の 3 番目の段階「新しい段階」");
    });

    it("同じ名前の札（どちらも札番号が未入力）は、札の並びの位置を添えて見分けられる文にする", () => {
      const doc = editDoc(def, (draft) => {
        fudaOf(draft, "tago").gameNumber = null;
        fudaOf(draft, "sixth").gameNumber = null;
        fudaOf(draft, "sixth").name = "多号作戦部隊";
      });

      const messages = findPublishWarnings(doc, ALL_SHIP_NAMES).map((w) => w.message);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain("2 番目の札「多号作戦部隊」");
      expect(messages[1]).toContain("5 番目の札「多号作戦部隊」");
    });
  });
});
