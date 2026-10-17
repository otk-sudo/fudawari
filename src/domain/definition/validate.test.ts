import { describe, expect, it } from "vitest";
import { cloneSummer2026Definition, type Mutable, summer2026Definition } from "@/test/fixtures";
import type {
  BoostGroup,
  DefinitionErrorCode,
  DefinitionValidationResult,
  EventInfo,
  Fuda,
  PublicDefinition,
  Stage,
} from "./types";
import { parsePublicDefinition, validatePublicDefinition } from "./validate";

// ---- テストの補助 ----

/** 壊した例を作るための、書き換えられる定義（公開定義の型は読み取り専用のため） */
type Draft = Mutable<PublicDefinition>;

/** テスト用の定義の複製を 1 か所だけ壊して返す */
function broken(breakIt: (draft: Draft) => void): unknown {
  const draft = cloneSummer2026Definition();
  breakIt(draft);
  return draft;
}

/** テスト用の定義で、段階 ID の配列の位置（path を組み立てるため） */
function stageIndex(stageId: string): number {
  const index = summer2026Definition.stages.findIndex((s) => s.id === stageId);
  if (index < 0) throw new Error(`テスト用の定義に段階 ${stageId} がありません`);
  return index;
}

/** 結果が失敗で、指定の種類と場所のエラーを含み、どのエラーにも理由の文があることを確かめる */
function expectError(result: DefinitionValidationResult, code: DefinitionErrorCode, path: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.errors).toContainEqual(expect.objectContaining({ code, path }));
  for (const error of result.errors) {
    expect(error.message).toEqual(expect.any(String));
    expect(error.message.length).toBeGreaterThan(0);
  }
}

/** 結果が成功であることを確かめて値を返す */
function expectOk(result: DefinitionValidationResult): PublicDefinition {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("検証に失敗しました");
  return result.value;
}

/**
 * 値の中で凍結されていないオブジェクト・配列の場所を集める（すべて凍結されていれば空の配列）。
 * 場所はエラーの path と同じ形（ルートは ""、"stages[4].boosts[0].shipNames" など）
 */
function unfrozenPaths(value: unknown, path = ""): string[] {
  if (typeof value !== "object" || value === null) return [];
  const self = Object.isFrozen(value) ? [] : [path];
  const children = Array.isArray(value)
    ? value.flatMap((item: unknown, index) => unfrozenPaths(item, `${path}[${index}]`))
    : Object.entries(value).flatMap(([key, child]) =>
        unfrozenPaths(child, path === "" ? key : `${path}.${key}`),
      );
  return [...self, ...children];
}

const E2_3 = stageIndex("E2-3");
const E2_2 = stageIndex("E2-2");

describe("validatePublicDefinition（公開定義 JSON の検証）", () => {
  describe("正しい定義", () => {
    it("2026夏イベのテスト用定義は検証を通り、同じ内容の型付きの値が得られる", () => {
      // 実行
      const result = validatePublicDefinition(cloneSummer2026Definition());

      // 検証
      expect(expectOk(result)).toEqual(summer2026Definition);
    });

    it("ゲーム内の札番号を省略した札は通り、検証後の値では null になる（U10：札番号は任意）", () => {
      // 準備
      const input = broken((d) => {
        delete (d.fudas[0] as Partial<Mutable<Fuda>>).gameNumber;
      });

      // 実行
      const value = expectOk(validatePublicDefinition(input));

      // 検証
      expect(value.fudas[0].gameNumber).toBeNull();
    });

    it("終了日時を省略した定義は通り、検証後の値では null になる", () => {
      const input = broken((d) => {
        delete (d.event as Partial<Mutable<EventInfo>>).endAt;
      });

      const value = expectOk(validatePublicDefinition(input));

      expect(value.event.endAt).toBeNull();
    });

    it("終了日時が開始日時より後なら通る", () => {
      const input = broken((d) => {
        d.event.endAt = "2026-10-31T11:00:00+09:00";
      });

      const value = expectOk(validatePublicDefinition(input));

      expect(value.event.endAt).toBe("2026-10-31T11:00:00+09:00");
    });

    it.each([
      ["秒を省いた日時", "2026-08-07T12:00+09:00"],
      ["時差が Z の日時", "2026-08-07T03:00:00Z"],
    ])("%s も開始日時として通る", (_label, startAt) => {
      const input = broken((d) => {
        d.event.startAt = startAt;
      });

      expectOk(validatePublicDefinition(input));
    });

    it("倍率がちょうど 1 の特効グループは通る（1 未満だけが誤り）", () => {
      const input = broken((d) => {
        d.stages[E2_3].boosts[0].multiplier = 1;
      });

      expectOk(validatePublicDefinition(input));
    });

    it("段階がない海域、特効が未入力の段階、グループ名が空の特効グループは通る", () => {
      // 準備：E4（段階なし）を足す。E3 ギミックはもともと特効が未入力
      const input = broken((d) => {
        d.areas.push({ id: "E4", name: "E4" });
        d.stages[E2_3].boosts[0].name = "";
      });

      // 実行
      const value = expectOk(validatePublicDefinition(input));

      // 検証
      expect(value.areas.map((a) => a.id)).toEqual(["E1", "E2", "E3", "E4"]);
      expect(value.stages[stageIndex("E3-G")].boosts).toEqual([]);
    });
  });

  describe("参照の誤り", () => {
    it("存在しない札を参照する段階は unknown_reference になる", () => {
      const input = broken((d) => {
        d.stages[E2_3].fudaId = "no-such-fuda";
      });

      expectError(validatePublicDefinition(input), "unknown_reference", `stages[${E2_3}].fudaId`);
    });

    it("存在しない海域を参照する段階は unknown_reference になる", () => {
      const input = broken((d) => {
        d.stages[0].areaId = "E9";
      });

      expectError(validatePublicDefinition(input), "unknown_reference", "stages[0].areaId");
    });
  });

  describe("倍率の誤り", () => {
    it.each([
      ["文字列", "1.27"],
      ["null", null],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
    ])("数値でない倍率（%s）は invalid_type になる", (_label, multiplier) => {
      const input = broken((d) => {
        d.stages[E2_3].boosts[0].multiplier = multiplier as unknown as number;
      });

      expectError(
        validatePublicDefinition(input),
        "invalid_type",
        `stages[${E2_3}].boosts[0].multiplier`,
      );
    });

    it.each([0.99, 0, -1.27])("1 未満の倍率（%s）は invalid_value になる", (multiplier) => {
      const input = broken((d) => {
        d.stages[E2_3].boosts[0].multiplier = multiplier;
      });

      expectError(
        validatePublicDefinition(input),
        "invalid_value",
        `stages[${E2_3}].boosts[0].multiplier`,
      );
    });
  });

  describe("ID の重複", () => {
    it("海域の ID が重複していると、2 つ目の場所で duplicate_id になる", () => {
      const input = broken((d) => {
        d.areas[1].id = d.areas[0].id;
      });

      expectError(validatePublicDefinition(input), "duplicate_id", "areas[1].id");
    });

    it("札の ID が重複していると duplicate_id になる", () => {
      const input = broken((d) => {
        d.fudas[2].id = d.fudas[0].id;
      });

      expectError(validatePublicDefinition(input), "duplicate_id", "fudas[2].id");
    });

    it("段階の ID が重複していると duplicate_id になる", () => {
      const input = broken((d) => {
        d.stages[E2_3].id = d.stages[E2_2].id;
      });

      expectError(validatePublicDefinition(input), "duplicate_id", `stages[${E2_3}].id`);
    });

    it("特効グループの ID は段階をまたいでも重複できない", () => {
      const input = broken((d) => {
        d.stages[E2_3].boosts[1].id = d.stages[E2_2].boosts[0].id;
      });

      expectError(validatePublicDefinition(input), "duplicate_id", `stages[${E2_3}].boosts[1].id`);
    });
  });

  describe("必須項目の欠け", () => {
    it.each<[string, (d: Draft) => void]>([
      ["schemaVersion", (d) => delete (d as Partial<Draft>).schemaVersion],
      ["event", (d) => delete (d as Partial<Draft>).event],
      ["event.id", (d) => delete (d.event as Partial<Mutable<EventInfo>>).id],
      ["event.name", (d) => delete (d.event as Partial<Mutable<EventInfo>>).name],
      ["event.startAt", (d) => delete (d.event as Partial<Mutable<EventInfo>>).startAt],
      ["event.versionDate", (d) => delete (d.event as Partial<Mutable<EventInfo>>).versionDate],
      ["areas", (d) => delete (d as Partial<Draft>).areas],
      ["fudas", (d) => delete (d as Partial<Draft>).fudas],
      ["stages", (d) => delete (d as Partial<Draft>).stages],
      ["fudas[0].color", (d) => delete (d.fudas[0] as Partial<Mutable<Fuda>>).color],
      ["stages[0].fudaId", (d) => delete (d.stages[0] as Partial<Mutable<Stage>>).fudaId],
      ["stages[0].areaId", (d) => delete (d.stages[0] as Partial<Mutable<Stage>>).areaId],
      ["stages[0].importance", (d) => delete (d.stages[0] as Partial<Mutable<Stage>>).importance],
      ["stages[0].boosts", (d) => delete (d.stages[0] as Partial<Mutable<Stage>>).boosts],
      [
        "stages[0].boosts[0].name",
        (d) => delete (d.stages[0].boosts[0] as Partial<Mutable<BoostGroup>>).name,
      ],
      [
        "stages[0].boosts[0].multiplier",
        (d) => delete (d.stages[0].boosts[0] as Partial<Mutable<BoostGroup>>).multiplier,
      ],
      [
        "stages[0].boosts[0].shipNames",
        (d) => delete (d.stages[0].boosts[0] as Partial<Mutable<BoostGroup>>).shipNames,
      ],
    ])("%s がないと missing_field になる", (path, breakIt) => {
      const input = broken(breakIt);

      expectError(validatePublicDefinition(input), "missing_field", path);
    });
  });

  describe("値の誤り", () => {
    it.each(["critical", "", "難所"])("大事さが 3 種以外の文字列（%s）だと invalid_value になる", (importance) => {
      const input = broken((d) => {
        d.stages[E2_3].importance = importance as Stage["importance"];
      });

      expectError(validatePublicDefinition(input), "invalid_value", `stages[${E2_3}].importance`);
    });

    it("大事さが文字列でない（重みの数 3）と invalid_type になる", () => {
      const input = broken((d) => {
        d.stages[E2_3].importance = 3 as unknown as Stage["importance"];
      });

      expectError(validatePublicDefinition(input), "invalid_type", `stages[${E2_3}].importance`);
    });

    it.each(["blue", "#12345", "8B93A1"])("札の色が #RRGGBB でない（%s）と invalid_value になる", (color) => {
      const input = broken((d) => {
        d.fudas[0].color = color;
      });

      expectError(validatePublicDefinition(input), "invalid_value", "fudas[0].color");
    });

    it.each([0, -1, 1.5])("ゲーム内の札番号が 1 以上の整数でない（%s）と invalid_value になる", (gameNumber) => {
      const input = broken((d) => {
        d.fudas[0].gameNumber = gameNumber;
      });

      expectError(validatePublicDefinition(input), "invalid_value", "fudas[0].gameNumber");
    });

    it("ゲーム内の札番号が文字列だと invalid_type になる", () => {
      const input = broken((d) => {
        d.fudas[0].gameNumber = "1" as unknown as number;
      });

      expectError(validatePublicDefinition(input), "invalid_type", "fudas[0].gameNumber");
    });

    it("ゲーム内の札番号が札どうしで重複すると、2 つ目の場所で duplicate_value になる", () => {
      const input = broken((d) => {
        d.fudas[3].gameNumber = d.fudas[1].gameNumber;
      });

      expectError(validatePublicDefinition(input), "duplicate_value", "fudas[3].gameNumber");
    });

    it.each([
      ["区切りが違う", "2026/08/07 12:00"],
      ["時差がない", "2026-08-07T12:00:00"],
      ["日時でない", "未定"],
    ])("開始日時の形式が違う（%s）と invalid_value になる", (_label, startAt) => {
      const input = broken((d) => {
        d.event.startAt = startAt;
      });

      expectError(validatePublicDefinition(input), "invalid_value", "event.startAt");
    });

    it.each([
      ["開始日時より前", "2026-08-01T12:00:00+09:00"],
      ["開始日時と同じ", "2026-08-07T12:00:00+09:00"],
    ])("終了日時が%sだと invalid_value になる", (_label, endAt) => {
      const input = broken((d) => {
        d.event.endAt = endAt;
      });

      expectError(validatePublicDefinition(input), "invalid_value", "event.endAt");
    });

    it.each(["2026/08/04", "2026-13-01", "2026-02-30"])(
      "版の日付が実在する YYYY-MM-DD でない（%s）と invalid_value になる",
      (versionDate) => {
        const input = broken((d) => {
          d.event.versionDate = versionDate;
        });

        expectError(validatePublicDefinition(input), "invalid_value", "event.versionDate");
      },
    );

    it.each<[string, (d: Draft) => void]>([
      ["event.name", (d) => (d.event.name = "")],
      ["areas[0].name", (d) => (d.areas[0].name = "")],
      ["fudas[0].name", (d) => (d.fudas[0].name = "")],
      ["stages[0].name", (d) => (d.stages[0].name = "")],
      ["fudas[0].id", (d) => (d.fudas[0].id = "")],
    ])("%s が空の文字列だと invalid_value になる", (path, breakIt) => {
      const input = broken(breakIt);

      expectError(validatePublicDefinition(input), "invalid_value", path);
    });

    it("特効グループの艦名に空の文字列があると invalid_value になる", () => {
      const input = broken((d) => {
        d.stages[E2_3].boosts[0].shipNames = ["初霜", ""];
      });

      expectError(
        validatePublicDefinition(input),
        "invalid_value",
        `stages[${E2_3}].boosts[0].shipNames[1]`,
      );
    });

    it("特効グループの艦名に文字列でないものがあると invalid_type になる", () => {
      const input = broken((d) => {
        d.stages[E2_3].boosts[0].shipNames = [123 as unknown as string];
      });

      expectError(
        validatePublicDefinition(input),
        "invalid_type",
        `stages[${E2_3}].boosts[0].shipNames[0]`,
      );
    });

    it("schemaVersion が 1 以外だと unsupported_version になる", () => {
      const input = broken((d) => {
        (d as unknown as { schemaVersion: number }).schemaVersion = 2;
      });

      expectError(validatePublicDefinition(input), "unsupported_version", "schemaVersion");
    });

    it("配列のはずの項目がオブジェクトだと invalid_type になる", () => {
      const input = broken((d) => {
        (d as unknown as { stages: unknown }).stages = { "E1-1": d.stages[0] };
      });

      expectError(validatePublicDefinition(input), "invalid_type", "stages");
    });
  });

  describe("特効グループの国籍（v1.1。nationalities）", () => {
    /** E2 ゲージ3 の最初のグループの国籍に、中身の分からない値を入れた入力 */
    function withNationalities(value: unknown): unknown {
      return broken((d) => {
        (d.stages[E2_3].boosts[0] as unknown as Record<string, unknown>).nationalities = value;
      });
    }

    const groupPath = `stages[${E2_3}].boosts[0]`;

    it("国籍を持つグループは通り、検証後の値の国籍は入力の順のまま", () => {
      // 準備：BOOST_NATIONALITIES の順（アメリカ → イギリス）とは逆の順で入れる
      const input = withNationalities(["uk", "usa"]);

      // 実行
      const value = expectOk(validatePublicDefinition(input));

      // 検証
      expect(value.stages[E2_3].boosts[0].nationalities).toEqual(["uk", "usa"]);
    });

    it("12 か国（unknown 以外）はどれも選べる", () => {
      const all = ["japan", "usa", "uk", "germany", "italy", "france", "soviet", "netherlands", "australia", "sweden", "norway", "thailand"];

      const value = expectOk(validatePublicDefinition(withNationalities(all)));

      expect(value.stages[E2_3].boosts[0].nationalities).toEqual(all);
    });

    it("艦名がなく国籍だけのグループも通る（艦名も国籍もないグループも、今と同じく誤りにしない）", () => {
      const input = broken((d) => {
        const group = d.stages[E2_3].boosts[0] as unknown as Record<string, unknown>;
        group.shipNames = [];
        group.nationalities = ["usa"];
        d.stages[E2_3].boosts[1].shipNames = [];
      });

      const value = expectOk(validatePublicDefinition(input));

      expect(value.stages[E2_3].boosts[0]).toMatchObject({ shipNames: [], nationalities: ["usa"] });
    });

    it("国籍を省略したグループは通り、検証後の値は nationalities の項目を持たない（キー自体がない）", () => {
      // 実行：テスト用の定義はどのグループも国籍を持たない
      const value = expectOk(validatePublicDefinition(cloneSummer2026Definition()));

      // 検証
      const groups = value.stages.flatMap((s) => s.boosts);
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.filter((g) => Object.hasOwn(g, "nationalities")).map((g) => g.id)).toEqual([]);
    });

    it("国籍が空の配列なら通り、検証後の値は nationalities の項目を持たない（省略と同じ）", () => {
      const value = expectOk(validatePublicDefinition(withNationalities([])));

      expect(Object.hasOwn(value.stages[E2_3].boosts[0], "nationalities")).toBe(false);
      expect(value.stages[E2_3].boosts[0]).toEqual(summer2026Definition.stages[E2_3].boosts[0]);
    });

    it("国籍を持つグループの国籍の配列も深く凍結されている", () => {
      const value = expectOk(validatePublicDefinition(withNationalities(["usa"])));

      expect(value.stages[E2_3].boosts[0].nationalities).toEqual(["usa"]);
      expect(Object.isFrozen(value.stages[E2_3].boosts[0].nationalities)).toBe(true);
      expect(unfrozenPaths(value)).toEqual([]);
    });

    it.each<[string, unknown]>([
      ["文字列", "usa"],
      ["オブジェクト", { usa: true }],
      ["数", 1],
      ["null", null],
    ])("国籍が配列でない（%s）と invalid_type（path はグループの nationalities）になる", (_label, value) => {
      expectError(validatePublicDefinition(withNationalities(value)), "invalid_type", `${groupPath}.nationalities`);
    });

    it.each<[string, unknown]>([
      ["数", 1],
      ["null", null],
      ["配列", ["usa"]],
      ["オブジェクト", { id: "usa" }],
    ])("国籍の要素が文字列でない（%s）と、その要素の場所で invalid_type になる", (_label, item) => {
      expectError(
        validatePublicDefinition(withNationalities(["usa", item])),
        "invalid_type",
        `${groupPath}.nationalities[1]`,
      );
    });

    it.each<[string, string]>([
      ["unknown（国籍ではあるが選べない）", "unknown"],
      ["知らない国籍", "china"],
      ["表示名（日本語）", "アメリカ"],
      ["大文字の違い", "USA"],
      ["空の文字列", ""],
    ])("国籍の要素が選べる国籍でない（%s）と、その要素の場所で invalid_value になる", (_label, item) => {
      expectError(
        validatePublicDefinition(withNationalities(["usa", item])),
        "invalid_value",
        `${groupPath}.nationalities[1]`,
      );
    });

    it("国籍が重複していると、2 つ目以降の場所で duplicate_value になる（1 つ目の場所は誤りにしない）", () => {
      // 実行
      const result = validatePublicDefinition(withNationalities(["usa", "uk", "usa", "usa"]));

      // 検証
      expectError(result, "duplicate_value", `${groupPath}.nationalities[2]`);
      expectError(result, "duplicate_value", `${groupPath}.nationalities[3]`);
      if (!result.ok) {
        const paths = result.errors.map((e) => e.path);
        expect(paths).not.toContain(`${groupPath}.nationalities[0]`);
        expect(paths).not.toContain(`${groupPath}.nationalities[1]`);
      }
    });

    it("別のグループどうしで同じ国籍を持つのは重複にしない", () => {
      const input = broken((d) => {
        (d.stages[E2_3].boosts[0] as unknown as Record<string, unknown>).nationalities = ["usa"];
        (d.stages[E2_3].boosts[1] as unknown as Record<string, unknown>).nationalities = ["usa"];
      });

      expectOk(validatePublicDefinition(input));
    });

    it("parsePublicDefinition（JSON の文字列）でも、国籍を持つグループは通り、国籍のないグループはキーを持たない", () => {
      // 準備
      const input = withNationalities(["usa"]);

      // 実行
      const value = expectOk(parsePublicDefinition(JSON.stringify(input)));

      // 検証
      expect(value.stages[E2_3].boosts[0].nationalities).toEqual(["usa"]);
      expect(Object.hasOwn(value.stages[E2_3].boosts[1], "nationalities")).toBe(false);
    });
  });

  describe("壊れた入力でも例外を投げず、結果で返す", () => {
    it.each<[string, unknown]>([
      ["null", null],
      ["undefined", undefined],
      ["数", 42],
      ["文字列", "svdata="],
      ["配列", []],
    ])("ルートがオブジェクトでない（%s）と invalid_type（path は空）になる", (_label, input) => {
      // 実行・検証：例外を投げず、結果で返す
      expect(() => validatePublicDefinition(input)).not.toThrow();
      expectError(validatePublicDefinition(input), "invalid_type", "");
    });

    it("中身が壊れたオブジェクトでも例外を投げない", () => {
      const input = {
        schemaVersion: 1,
        event: null,
        areas: [null, 1, "E1"],
        fudas: [{ id: 1 }],
        stages: [null, { id: "x", boosts: [null, { multiplier: "x" }] }, { boosts: "x" }],
      };

      expect(() => validatePublicDefinition(input)).not.toThrow();
      expect(validatePublicDefinition(input).ok).toBe(false);
    });

    it("空のオブジェクトは、欠けた必須項目をすべて返す", () => {
      const result = validatePublicDefinition({});

      for (const path of ["schemaVersion", "event", "areas", "fudas", "stages"]) {
        expectError(result, "missing_field", path);
      }
    });
  });

  it("誤りが複数あるときは、最初の 1 件で止めずにまとめて返す", () => {
    // 準備：違う場所を 2 か所壊す
    const input = broken((d) => {
      d.stages[E2_3].fudaId = "no-such-fuda";
      d.fudas[0].color = "blue";
    });

    // 実行
    const result = validatePublicDefinition(input);

    // 検証
    expectError(result, "unknown_reference", `stages[${E2_3}].fudaId`);
    expectError(result, "invalid_value", "fudas[0].color");
  });

  // 特効の計算（boost.ts）は定義・段階のオブジェクトごとに索引を覚えるため、検証後の定義は書き換えられない値にする
  describe("検証後の値は深く凍結されている", () => {
    it("ルート・各配列・各要素・入れ子の配列（空の配列も）まで Object.isFrozen が true", () => {
      // 実行
      const value = expectOk(validatePublicDefinition(cloneSummer2026Definition()));

      // 検証：代表の場所を名指しで確かめてから、残りもすべて凍結されていることを確かめる
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value.event)).toBe(true);
      expect(Object.isFrozen(value.areas)).toBe(true);
      expect(Object.isFrozen(value.areas[0])).toBe(true);
      expect(Object.isFrozen(value.fudas)).toBe(true);
      expect(Object.isFrozen(value.fudas[0])).toBe(true);
      expect(Object.isFrozen(value.stages)).toBe(true);
      expect(Object.isFrozen(value.stages[E2_3])).toBe(true);
      expect(Object.isFrozen(value.stages[E2_3].boosts)).toBe(true);
      expect(Object.isFrozen(value.stages[E2_3].boosts[0])).toBe(true);
      expect(Object.isFrozen(value.stages[E2_3].boosts[0].shipNames)).toBe(true);
      expect(Object.isFrozen(value.stages[stageIndex("E3-G")].boosts)).toBe(true);
      expect(unfrozenPaths(value)).toEqual([]);
    });

    it("省略を null にそろえた値（ゲーム内の札番号・終了日時を省いた入力）も深く凍結されている", () => {
      // 準備
      const input = broken((d) => {
        delete (d.fudas[0] as Partial<Mutable<Fuda>>).gameNumber;
        delete (d.event as Partial<Mutable<EventInfo>>).endAt;
      });

      // 実行
      const value = expectOk(validatePublicDefinition(input));

      // 検証
      expect(unfrozenPaths(value)).toEqual([]);
    });

    it("入力の値は凍結せず、内容も変えない（検証は呼び出し元の値に手を加えない）", () => {
      // 準備
      const input = cloneSummer2026Definition();

      // 実行
      validatePublicDefinition(input);

      // 検証
      expect(Object.isFrozen(input)).toBe(false);
      expect(Object.isFrozen(input.stages)).toBe(false);
      expect(Object.isFrozen(input.stages[E2_3].boosts[0].shipNames)).toBe(false);
      expect(input).toEqual(summer2026Definition);
    });
  });
});

describe("parsePublicDefinition（JSON の文字列を読んで検証）", () => {
  it("テスト用定義の JSON 文字列は通り、同じ内容の値が得られる", () => {
    const result = parsePublicDefinition(JSON.stringify(summer2026Definition));

    expect(expectOk(result)).toEqual(summer2026Definition);
  });

  it("読み込んだ値も、ルートから入れ子の配列まで深く凍結されている", () => {
    // 実行
    const value = expectOk(parsePublicDefinition(JSON.stringify(summer2026Definition)));

    // 検証
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.stages[E2_3].boosts[0].shipNames)).toBe(true);
    expect(unfrozenPaths(value)).toEqual([]);
  });

  it.each(["{", "", "svdata={}", "{'a': 1}"])(
    "JSON として読めない文字列（%j）は例外を投げず invalid_json（path は空）になる",
    (text) => {
      expect(() => parsePublicDefinition(text)).not.toThrow();
      expectError(parsePublicDefinition(text), "invalid_json", "");
    },
  );

  it("JSON として読めても形が違えば、validatePublicDefinition と同じ誤りを返す", () => {
    const text = JSON.stringify(
      broken((d) => {
        d.stages[E2_3].boosts[0].multiplier = 0.5;
      }),
    );

    expectError(parsePublicDefinition(text), "invalid_value", `stages[${E2_3}].boosts[0].multiplier`);
  });
});
