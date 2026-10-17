// 一覧と画像に出す値の書き方（list-view.ts）のテスト：取り込んだ日時の書き方、札の色の上の文字の色
import { describe, expect, it } from "vitest";
import { formatImportedAt, inkOn } from "@/features/list/list-view";

describe("取り込んだ日時の書き方（formatImportedAt。取り込みの画面と同じ「M/D HH:mm」）", () => {
  // 時差のない日時の文字は、端末の時刻帯の日時として読まれる（どの時刻帯で動かしても同じ結果になる）
  it.each<[string, string]>([
    ["2026-10-15T21:40:00", "10/15 21:40"],
    ["2026-03-05T07:04:00", "3/5 07:04"],
    ["2026-12-31T00:00:00", "12/31 00:00"],
  ])("%s → %s（月・日は 0 を付けず、時・分は 2 桁）", (iso, expected) => {
    // 準備・実行・検証
    expect(formatImportedAt(iso)).toBe(expected);
  });

  it("時差つきの日時は、端末の時刻帯に直して書く", () => {
    // 準備
    const iso = "2026-10-16T21:00:00.000+09:00";
    const local = new Date(iso);

    // 実行
    const text = formatImportedAt(iso);

    // 検証：月・日・時・分が端末の時刻帯の値（書式は上のテストで確かめている）
    expect(text).toBe(
      `${local.getMonth() + 1}/${local.getDate()} ${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`,
    );
  });

  it.each(["", "日時ではない", "2026-13-40T99:99:99"])("日時として読めない文字（%j）なら null", (iso) => {
    // 準備・実行・検証
    expect(formatImportedAt(iso)).toBeNull();
  });
});

describe("札の色の上の文字の色（inkOn）", () => {
  it.each<[string, "dark" | "light"]>([
    ["#8B93A1", "dark"], // 第三十一戦隊（明るい灰色）
    ["#5FB0E8", "dark"], // 多号作戦部隊（明るい水色）
    ["#4C8DF6", "dark"], // 連合艦隊（コントラスト比は暗い文字の方が高い）
    ["#FFFFFF", "dark"],
    ["#000000", "light"],
    ["#6C5CE7", "light"], // 濃い紫
    ["#1E3A8A", "light"], // 濃い青
  ])("%s の上は %s の文字", (color, expected) => {
    // 準備・実行・検証
    expect(inkOn(color)).toBe(expected);
  });

  it("小文字の 16 進でも同じ", () => {
    // 準備・実行・検証
    expect(inkOn("#6c5ce7")).toBe(inkOn("#6C5CE7"));
  });

  it.each(["", "red", "#FFF", "#12345G", "rgb(0, 0, 0)"])("#RRGGBB の形でない色（%j）は暗い文字", (color) => {
    // 準備・実行・検証
    expect(inkOn(color)).toBe("dark");
  });
});
