import { describe, expect, it } from "vitest";
import { importanceLabel, importanceWeight } from "./importance";
import type { Importance } from "./types";

describe("大事さ", () => {
  it.each<[Importance, number, string]>([
    ["normal", 1, "普通"],
    ["important", 2, "重要"],
    ["hard", 3, "難所"],
  ])("%s の重みは %i、表示名は「%s」", (importance, weight, label) => {
    // 実行・検証
    expect(importanceWeight(importance)).toBe(weight);
    expect(importanceLabel(importance)).toBe(label);
  });
});
