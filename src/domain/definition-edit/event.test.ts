// イベントの情報（名前・日時）の編集と検証、終了の判定（roadmap T3-6）のテスト
// 今の時刻は引数で渡す（テストでは 2026-10-15 23:42 JST に固定）。
import { describe, expect, it } from "vitest";
import { validatePublicDefinition } from "@/domain/definition";
import { summer2026Definition } from "@/test/fixtures";
import { isEventEnded, updateEvent, validateEventInfo } from "./event";
import { expectOk } from "./test-helpers";
import type { EventInfoInput } from "./types";

const def = summer2026Definition;

const NOW = new Date("2026-10-15T23:42:00+09:00");
const START = "2026-08-07T12:00:00+09:00";

const MSG_END_BEFORE_START = "終了日時は開始日時より後にしてください";
const MSG_END_IN_PAST = "終了日時は今より後にしてください（過去の日時にすると、その場で更新できなくなるため）";

/** 検証の入力（既定は、正しい値の新規作成） */
function input(fields: Partial<EventInfoInput>): EventInfoInput {
  return { mode: "create", name: "2026秋イベ", startAt: "2026-11-20T12:00+09:00", endAt: null, now: NOW, ...fields };
}

/** エラーを [欄, 種類] の組にして比べやすくする */
function codes(value: EventInfoInput): [string, string][] {
  return validateEventInfo(value).map((e) => [e.field, e.code]);
}

describe("updateEvent（イベントの名前・日時の変更）", () => {
  it("指定した項目だけを変え、ほかは変えない", () => {
    const doc = expectOk(updateEvent(def, { name: "2026夏イベ（後段）", endAt: "2026-10-20T11:00+09:00" }));

    expect(doc.event).toEqual({ ...def.event, name: "2026夏イベ（後段）", endAt: "2026-10-20T11:00+09:00" });
    expect(doc.stages).toEqual(def.stages);
  });

  it("終了日時を消せる（null）", () => {
    const withEnd = expectOk(updateEvent(def, { endAt: "2026-10-20T11:00+09:00" }));
    const cleared = expectOk(updateEvent(withEnd, { endAt: null }));

    expect(cleared.event.endAt).toBeNull();
  });

  it("終了日時に空文字や空白だけを渡したら、未定（null）にそろえる", () => {
    const withEnd = expectOk(updateEvent(def, { endAt: "2026-10-20T11:00+09:00" }));

    expect(expectOk(updateEvent(withEnd, { endAt: "" })).event.endAt).toBeNull();
    expect(expectOk(updateEvent(withEnd, { endAt: " 　 " })).event.endAt).toBeNull();
  });

  it("終了日時を空文字で消した文書は、公開定義の検証の日時の規則に合う", () => {
    const withEnd = expectOk(updateEvent(def, { endAt: "2026-10-20T11:00+09:00" }));
    const cleared = expectOk(updateEvent(withEnd, { endAt: "" }));

    expect(validatePublicDefinition(cleared).ok).toBe(true);
  });
});

describe("validateEventInfo（イベントの情報の検証）", () => {
  describe("新規作成", () => {
    it("正しい値ならエラーなし（終了日時は未定でよい）", () => {
      expect(validateEventInfo(input({}))).toEqual([]);
    });

    it("イベント名と開始日時は必須（required）", () => {
      expect(codes(input({ name: "", startAt: "" }))).toEqual(
        expect.arrayContaining([
          ["name", "required"],
          ["startAt", "required"],
        ]),
      );
      expect(validateEventInfo(input({ name: "", startAt: "" }))).toHaveLength(2);
    });

    it("空白だけのイベント名は入力していないものとして扱う", () => {
      expect(codes(input({ name: " 　 " }))).toEqual([["name", "required"]]);
    });

    it("終了日時の空文字は未定として扱う（エラーにしない）", () => {
      expect(validateEventInfo(input({ endAt: "" }))).toEqual([]);
    });

    it("終了日時の空白だけも未定として扱う（新規・更新とも。updateEvent が null にそろえるのと同じ扱い）", () => {
      expect(validateEventInfo(input({ endAt: " 　 " }))).toEqual([]);
      expect(validateEventInfo(input({ mode: "update", startAt: START, endAt: " 　 " }))).toEqual([]);
    });

    it("終了日時が開始日時より後ならエラーなし", () => {
      expect(validateEventInfo(input({ endAt: "2026-12-26T11:00+09:00" }))).toEqual([]);
    });

    it("終了日時が開始日時と同じなら end_before_start（開始日時より後でないといけない）", () => {
      const errors = validateEventInfo(input({ endAt: "2026-11-20T12:00+09:00" }));

      expect(errors).toEqual([{ field: "endAt", code: "end_before_start", message: MSG_END_BEFORE_START }]);
    });

    it("終了日時が開始日時より前なら end_before_start", () => {
      expect(codes(input({ endAt: "2026-11-19T12:00+09:00" }))).toEqual([["endAt", "end_before_start"]]);
    });

    it("前後は時刻で比べる（時差の書き方が違っても正しく比べる）", () => {
      // 終了 2026-11-20T04:00Z は 13:00 JST なので、開始 12:00 JST より後（文字列で比べると前に見える）
      expect(validateEventInfo(input({ endAt: "2026-11-20T04:00:00Z" }))).toEqual([]);
      // 終了 2026-11-20T02:00Z は 11:00 JST なので、開始より前
      expect(codes(input({ endAt: "2026-11-20T02:00:00Z" }))).toEqual([["endAt", "end_before_start"]]);
    });

    it("新規作成では、今より前の終了日時でも end_in_past にしない", () => {
      const pastEvent = input({ startAt: "2026-09-01T12:00+09:00", endAt: "2026-09-30T11:00+09:00" });

      expect(validateEventInfo(pastEvent)).toEqual([]);
    });

    it("日時の形式が違えば invalid_format（時差のない値も不可）", () => {
      expect(codes(input({ startAt: "2026/11/20 12:00" }))).toEqual([["startAt", "invalid_format"]]);
      expect(codes(input({ startAt: "2026-11-20T12:00" }))).toEqual([["startAt", "invalid_format"]]);
      expect(codes(input({ endAt: "あした" }))).toEqual([["endAt", "invalid_format"]]);
    });

    it("秒つき・秒なし・Z のどれも正しい形式として受け付ける", () => {
      expect(validateEventInfo(input({ startAt: "2026-11-20T12:00:00+09:00" }))).toEqual([]);
      expect(validateEventInfo(input({ startAt: "2026-11-20T03:00Z" }))).toEqual([]);
    });

    it("開始日時が空のときは、終了日時の前後を比べない", () => {
      expect(codes(input({ startAt: "", endAt: "2026-11-20T12:00+09:00" }))).toEqual([["startAt", "required"]]);
    });
  });

  describe("既存を更新", () => {
    it("終了日時が今より後ならエラーなし", () => {
      expect(validateEventInfo(input({ mode: "update", startAt: START, endAt: "2026-10-20T11:00+09:00" }))).toEqual(
        [],
      );
    });

    it("終了日時が未定ならエラーなし", () => {
      expect(validateEventInfo(input({ mode: "update", startAt: START, endAt: null }))).toEqual([]);
    });

    it("終了日時が今より前なら end_in_past（誤ってロックしないため）", () => {
      const errors = validateEventInfo(input({ mode: "update", startAt: START, endAt: "2026-10-10T11:00+09:00" }));

      expect(errors).toEqual([{ field: "endAt", code: "end_in_past", message: MSG_END_IN_PAST }]);
    });

    it("終了日時が今とちょうど同じでも end_in_past、1 分後ならエラーなし", () => {
      expect(codes(input({ mode: "update", startAt: START, endAt: "2026-10-15T23:42+09:00" }))).toEqual([
        ["endAt", "end_in_past"],
      ]);
      expect(validateEventInfo(input({ mode: "update", startAt: START, endAt: "2026-10-15T23:43+09:00" }))).toEqual(
        [],
      );
    });

    it("終了日時が開始日時以前で、しかも今より前なら、end_before_start の 1 件だけ", () => {
      expect(codes(input({ mode: "update", startAt: START, endAt: "2026-08-01T12:00+09:00" }))).toEqual([
        ["endAt", "end_before_start"],
      ]);
    });

    it("更新でも、イベント名と開始日時は空にできない（required）", () => {
      expect(codes(input({ mode: "update", name: "", startAt: "" }))).toEqual(
        expect.arrayContaining([
          ["name", "required"],
          ["startAt", "required"],
        ]),
      );
    });
  });
});

describe("isEventEnded（終了の判定。保存済みの終了日時で行う）", () => {
  it("終了日時が未定（null）なら終了していない", () => {
    expect(isEventEnded(null, NOW)).toBe(false);
  });

  it("終了日時が今より後なら終了していない", () => {
    expect(isEventEnded("2026-10-20T11:00+09:00", NOW)).toBe(false);
  });

  it("終了日時が今より前なら終了している", () => {
    expect(isEventEnded("2026-10-10T11:00+09:00", NOW)).toBe(true);
  });

  it("終了日時が今とちょうど同じなら終了している", () => {
    expect(isEventEnded("2026-10-15T23:42+09:00", NOW)).toBe(true);
  });

  it("時刻で比べる（時差の書き方が違っても正しく判定する）", () => {
    // 2026-10-15T14:00Z は 23:00 JST なので、今（23:42 JST）より前
    expect(isEventEnded("2026-10-15T14:00:00Z", NOW)).toBe(true);
    // 2026-10-15T15:00Z は 2026-10-16 00:00 JST なので、今より後
    expect(isEventEnded("2026-10-15T15:00:00Z", NOW)).toBe(false);
  });
});
