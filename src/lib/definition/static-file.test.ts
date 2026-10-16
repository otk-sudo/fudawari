import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePublicDefinition } from "@/domain/definition";
import { summer2026Definition } from "@/test/fixtures";

// 一般の画面が読む静的ファイル（public/data/latest-definition.json）の中身を確かめる。
// 今はテスト用の 2026夏イベの定義を置いている。ビルド時に Supabase から生成する仕組み（PR-13）を入れるときに、
// 「テスト用の定義と同じ」の確認は見直す（検証を通ることの確認は残す）
const STATIC_FILE = resolve(process.cwd(), "public/data/latest-definition.json");

describe("最新イベントの公開定義の静的ファイル（public/data/latest-definition.json）", () => {
  it("検証（parsePublicDefinition）を通る", () => {
    // 準備
    const text = readFileSync(STATIC_FILE, "utf8");

    // 実行
    const result = parsePublicDefinition(text);

    // 検証：失敗なら誤りの一覧が見えるように比べる
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it("中身はテスト用の 2026夏イベの定義（src/test/fixtures/summer2026Definition.ts）と同じ", () => {
    // 準備・実行
    const parsed: unknown = JSON.parse(readFileSync(STATIC_FILE, "utf8"));

    // 検証
    expect(parsed).toEqual(summer2026Definition);
  });
});
