// 国籍の型・表示名・判定（v1.1「特効グループに国籍の条件を足す」の仕様 1 章）のテスト
// 公開の入口（src/domain/nationality/index.ts）から読み込んで、公開されていることも確かめる。
import { describe, expect, it } from "vitest";
import {
  BOOST_NATIONALITIES,
  type BoostNationality,
  isBoostNationality,
  isNationality,
  type Nationality,
  nationalityLabel,
} from "@/domain/nationality";

/** 仕様の表示名（国籍 → 表示名） */
const LABELS: readonly (readonly [Nationality, string])[] = [
  ["japan", "日本"],
  ["usa", "アメリカ"],
  ["uk", "イギリス"],
  ["germany", "ドイツ"],
  ["italy", "イタリア"],
  ["france", "フランス"],
  ["soviet", "ソ連"],
  ["netherlands", "オランダ"],
  ["australia", "オーストラリア"],
  ["sweden", "スウェーデン"],
  ["norway", "ノルウェー"],
  ["thailand", "タイ"],
  ["unknown", "不明"],
];

describe("BOOST_NATIONALITIES（定義で選べる国籍。画面・保存の正規の順）", () => {
  it("unknown を除く 12 か国を、日本・アメリカ・イギリス・ドイツ・イタリア・フランス・ソ連・オランダ・オーストラリア・スウェーデン・ノルウェー・タイの順に持つ", () => {
    expect(BOOST_NATIONALITIES).toEqual<BoostNationality[]>([
      "japan",
      "usa",
      "uk",
      "germany",
      "italy",
      "france",
      "soviet",
      "netherlands",
      "australia",
      "sweden",
      "norway",
      "thailand",
    ]);
  });

  it("unknown は選べない（含まない）", () => {
    expect(BOOST_NATIONALITIES as readonly string[]).not.toContain("unknown");
  });
});

describe("nationalityLabel（国籍の表示名）", () => {
  it.each(LABELS)("%s の表示名は「%s」", (nationality, label) => {
    expect(nationalityLabel(nationality)).toBe(label);
  });
});

describe("isNationality（中身の分からない値が国籍か）", () => {
  it.each(LABELS.map(([nationality]) => nationality))("%s は国籍", (nationality) => {
    expect(isNationality(nationality)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["知らない国籍の文字列", "china"],
    ["表示名（日本語）", "アメリカ"],
    ["大文字の違い", "USA"],
    ["空の文字列", ""],
    ["数", 1],
    ["null", null],
    ["undefined", undefined],
    ["配列", ["usa"]],
    ["オブジェクト", { nationality: "usa" }],
  ])("%s は国籍ではない", (_label, value) => {
    expect(isNationality(value)).toBe(false);
  });
});

describe("isBoostNationality（中身の分からない値が、定義で選べる国籍か）", () => {
  it.each(BOOST_NATIONALITIES.map((nationality) => [nationality]))("%s は選べる", (nationality) => {
    expect(isBoostNationality(nationality)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["unknown（国籍ではあるが選べない）", "unknown"],
    ["知らない国籍の文字列", "china"],
    ["空の文字列", ""],
    ["数", 0],
    ["null", null],
    ["undefined", undefined],
  ])("%s は選べない", (_label, value) => {
    expect(isBoostNationality(value)).toBe(false);
  });
});
