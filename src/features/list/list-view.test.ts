// 一覧と画像に出す値の書き方（list-view.ts）のテスト：取り込んだ日時の書き方、札の色の上の文字の色
import { describe, expect, it } from "vitest";
import { formatImportedAt, inkOn, readableInkOn } from "@/features/list/list-view";

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

// UI／UX レビュー 中12（一覧の分）：一覧の札の色の上の文字は、黒（#000000）と白（#FFFFFF）のうちコントラスト比の高い方にする。
// 黒と白の高い方は、どの色の上でも 4.58:1 以上になる（WCAG の AA の 4.5:1 に届く）
describe("一覧の札の色の上の文字の色（readableInkOn。黒か白か）", () => {
  it.each<[color: string, expected: "black" | "white", note: string]>([
    ["#B5651D", "black", "第六艦隊（黒 4.84:1・白 4.34:1。暗い文字 #101114 では 4.35:1 で届かない）"],
    ["#E5484D", "black", "連合艦隊（黒 5.37:1・白 3.91:1）"],
    ["#4C8DF6", "black", "第三十一戦隊（黒 6.45:1・白 3.26:1）"],
    ["#C9A227", "black", "ウルシー攻撃部隊"],
    ["#FFFFFF", "black", "白"],
    ["#6C5CE7", "white", "Force de Raid（黒 4.32:1・白 4.86:1）"],
    ["#1E3A8A", "white", "濃い青"],
    ["#000000", "white", "黒"],
  ])("%s の上は %s の文字（%s）", (color, expected) => {
    // 準備・実行・検証
    expect(readableInkOn(color)).toBe(expected);
  });

  it("小文字の 16 進でも同じ", () => {
    // 準備・実行・検証
    expect(readableInkOn("#6c5ce7")).toBe("white");
    expect(readableInkOn("#b5651d")).toBe("black");
  });

  it.each(["", "red", "#FFF", "#12345G", "rgb(0, 0, 0)"])(
    "#RRGGBB の形でない色（%j）は決めない（null。札の色で塗らないので、画面モードの文字の色を使う）",
    (color) => {
      // 準備・実行・検証
      expect(readableInkOn(color)).toBeNull();
    },
  );
});
