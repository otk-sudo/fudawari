// 日時の入力欄との変換と表示（PR-09 のレビュー指摘：PR-11 の日時の入力欄のために公開する）のテスト
//
// - 入力欄（<input type="datetime-local">）の値：時差のない "YYYY-MM-DDTHH:mm"。日本時間として解釈する
// - 文書の値：時差つきの ISO 8601（例 "2026-08-07T12:00+09:00"）
// - 読めない値は null（例外は投げない）
// 公開の入口（@/domain/definition-edit）から読み込んで、公開されていることも確かめる。
import { describe, expect, it } from "vitest";
import { validatePublicDefinition } from "@/domain/definition";
import { formatDateTimeJst, fromDateTimeLocalValue, toDateTimeLocalValue } from "@/domain/definition-edit";
import { summer2026Definition } from "@/test/fixtures";
import { sameDateTime } from "./datetime";
import { editDoc } from "./test-helpers";

describe("toDateTimeLocalValue（文書の日時 → 入力欄の値）", () => {
  it("日本時間の日時は、時差を外して分までにする", () => {
    expect(toDateTimeLocalValue("2026-08-07T12:00+09:00")).toBe("2026-08-07T12:00");
    expect(toDateTimeLocalValue("2026-08-07T12:00:00+09:00")).toBe("2026-08-07T12:00");
  });

  it("ほかの時差の日時は、日本時間に直す", () => {
    expect(toDateTimeLocalValue("2026-08-07T03:00Z")).toBe("2026-08-07T12:00");
    // 2026-08-06T23:30-04:00 は 2026-08-07T03:30Z、日本時間で 12:30
    expect(toDateTimeLocalValue("2026-08-06T23:30-04:00")).toBe("2026-08-07T12:30");
  });

  it("日本時間に直して日付が変わるときは、日付も直す（年をまたぐ場合を含む）", () => {
    expect(toDateTimeLocalValue("2026-12-31T15:00:00Z")).toBe("2027-01-01T00:00");
  });

  it("未定（null）・空文字・読めない値・時差のない値・実在しない日時は null", () => {
    expect(toDateTimeLocalValue(null)).toBeNull();
    expect(toDateTimeLocalValue("")).toBeNull();
    expect(toDateTimeLocalValue("あした")).toBeNull();
    expect(toDateTimeLocalValue("2026-08-07T12:00")).toBeNull();
    expect(toDateTimeLocalValue("2026-02-30T12:00+09:00")).toBeNull();
  });
});

describe("fromDateTimeLocalValue（入力欄の値 → 文書の日時）", () => {
  it("入力欄の値を日本時間として、時差 +09:00 を付ける", () => {
    expect(fromDateTimeLocalValue("2026-08-07T12:00")).toBe("2026-08-07T12:00+09:00");
    expect(fromDateTimeLocalValue("2027-01-01T00:00")).toBe("2027-01-01T00:00+09:00");
  });

  it("作った値は、公開定義の検証の日時の規則に合う", () => {
    const startAt = fromDateTimeLocalValue("2026-11-20T12:00");
    const endAt = fromDateTimeLocalValue("2026-12-26T11:00");
    expect(startAt).not.toBeNull();
    expect(endAt).not.toBeNull();
    const doc = editDoc(summer2026Definition, (d) => {
      d.event.startAt = startAt ?? "";
      d.event.endAt = endAt;
    });

    expect(validatePublicDefinition(doc).ok).toBe(true);
  });

  it("空文字・形式違い・時差つきの値・実在しない日時は null", () => {
    expect(fromDateTimeLocalValue("")).toBeNull();
    expect(fromDateTimeLocalValue("2026-08-07 12:00")).toBeNull();
    expect(fromDateTimeLocalValue("2026/08/07 12:00")).toBeNull();
    expect(fromDateTimeLocalValue("2026-08-07T12:00+09:00")).toBeNull();
    expect(fromDateTimeLocalValue("2026-02-30T12:00")).toBeNull();
    expect(fromDateTimeLocalValue("2026-08-07T24:00")).toBeNull();
  });

  it("入力欄の値 → 文書の日時 → 入力欄の値で、元の値に戻る", () => {
    const iso = fromDateTimeLocalValue("2026-10-20T11:00");

    expect(toDateTimeLocalValue(iso)).toBe("2026-10-20T11:00");
  });

  it("文書の日時 → 入力欄の値 → 文書の日時で、同じ時刻に戻る（時差の書き方は +09:00 になる）", () => {
    const original = "2026-10-20T02:00:00Z";
    const local = toDateTimeLocalValue(original);
    const back = local === null ? null : fromDateTimeLocalValue(local);

    expect(back).toBe("2026-10-20T11:00+09:00");
    expect(back !== null && sameDateTime(back, original)).toBe(true);
  });
});

describe("formatDateTimeJst（日本時間での表示）", () => {
  it("日時を「2026/10/20 11:00」の形（日本時間）にする。時差の書き方が違っても同じ時刻は同じ表示", () => {
    expect(formatDateTimeJst("2026-10-20T11:00+09:00")).toBe("2026/10/20 11:00");
    expect(formatDateTimeJst("2026-10-20T02:00:00Z")).toBe("2026/10/20 11:00");
  });

  it("読めない値は、例外を投げずにそのまま返す", () => {
    expect(formatDateTimeJst("あした")).toBe("あした");
    expect(formatDateTimeJst("")).toBe("");
  });
});
