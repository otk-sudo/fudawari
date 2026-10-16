// 札割りの書き出し・読み込みのファイル（U21）のテスト
import { describe, expect, it } from "vitest";
import { summer2026Assignments } from "@/test/fixtures";
import { type PlanFileFailureReason, parsePlanFile, serializePlanFile } from "./planFile";

describe("serializePlanFile（札割りを書き出す）", () => {
  it("形式の版・イベント ID・割り当てを持つ JSON にする", () => {
    // 実行
    const text = serializePlanFile("summer2026", { hatsushimo: "s31", okinami: "tago" });

    // 検証
    expect(JSON.parse(text)).toEqual({
      formatVersion: 1,
      eventId: "summer2026",
      assignments: { hatsushimo: "s31", okinami: "tago" },
    });
  });
});

describe("parsePlanFile（札割りを読み込む）", () => {
  it("書き出したファイルを読み込むと、同じイベント ID・同じ割り当てになる", () => {
    const text = serializePlanFile("summer2026", summer2026Assignments);

    const result = parsePlanFile(text);

    expect(result).toEqual({ ok: true, eventId: "summer2026", assignments: summer2026Assignments });
  });

  it("割り当てが空の札割り（全員が控え）も読み込める", () => {
    const result = parsePlanFile(serializePlanFile("summer2026", {}));

    expect(result).toEqual({ ok: true, eventId: "summer2026", assignments: {} });
  });

  it("手で書いた正しい形のファイルも読める（前後の空白・改行があってもよい）", () => {
    const text = `\n{ "formatVersion": 1, "eventId": "e1", "assignments": { "101": "rengo" } }\n`;

    expect(parsePlanFile(text)).toEqual({ ok: true, eventId: "e1", assignments: { "101": "rengo" } });
  });

  it.each<[string, PlanFileFailureReason, string]>([
    ["空", "invalidJson", ""],
    ["JSON でない文字", "invalidJson", "札割り"],
    ["途中で切れた JSON", "invalidJson", '{"formatVersion":1,"eventId":'],
    ["配列", "invalidFormat", "[]"],
    ["null", "invalidFormat", "null"],
    ["空のオブジェクト", "invalidFormat", "{}"],
    ["形式の版がない", "invalidFormat", '{"eventId":"e1","assignments":{}}'],
    ["形式の版が数でない", "invalidFormat", '{"formatVersion":"1","eventId":"e1","assignments":{}}'],
    ["イベント ID がない", "invalidFormat", '{"formatVersion":1,"assignments":{}}'],
    ["イベント ID が空", "invalidFormat", '{"formatVersion":1,"eventId":"","assignments":{}}'],
    ["イベント ID が文字列でない", "invalidFormat", '{"formatVersion":1,"eventId":1,"assignments":{}}'],
    ["割り当てがない", "invalidFormat", '{"formatVersion":1,"eventId":"e1"}'],
    ["割り当てが配列", "invalidFormat", '{"formatVersion":1,"eventId":"e1","assignments":["s31"]}'],
    ["割り当ての札 ID が文字列でない", "invalidFormat", '{"formatVersion":1,"eventId":"e1","assignments":{"101":3}}'],
    ["割り当ての札 ID が null", "invalidFormat", '{"formatVersion":1,"eventId":"e1","assignments":{"101":null}}'],
    ["知らない形式の版", "unsupportedVersion", '{"formatVersion":2,"eventId":"e1","assignments":{}}'],
  ])("壊れたファイル：%s → 理由 %s（例外を投げない）", (_label, reason, text) => {
    expect(parsePlanFile(text)).toEqual({ ok: false, reason });
  });
});
