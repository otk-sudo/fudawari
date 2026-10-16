import { describe, expect, it } from "vitest";
import type { EventInfo } from "@/domain/definition";
import { eventPhase, isEventRunning, nextEventBoundary } from "@/lib/definition";
import { summer2026Definition } from "@/test/fixtures";

// 判定に使うのは開始日時と終了日時だけ
type EventPeriod = Pick<EventInfo, "startAt" | "endAt">;

// 開始 2026-08-07 12:00、終了 2026-09-01 11:00（日本時間）のイベント
const PERIOD: EventPeriod = {
  startAt: "2026-08-07T12:00:00+09:00",
  endAt: "2026-09-01T11:00:00+09:00",
};

// 終了日時が未定（null）のイベント（テスト用の 2026夏イベと同じ開始日時）
const OPEN_ENDED: EventPeriod = {
  startAt: "2026-08-07T12:00:00+09:00",
  endAt: null,
};

describe("「開催中」の判定（isEventRunning）", () => {
  describe("終了日時があるとき", () => {
    it.each([
      ["開始前（開始の 1 秒前）", "2026-08-07T11:59:59+09:00", false],
      ["開始日時ちょうど", "2026-08-07T12:00:00+09:00", true],
      ["開催中（開始後・終了前）", "2026-08-20T21:00:00+09:00", true],
      ["終了の 1 秒前", "2026-09-01T10:59:59+09:00", true],
      ["終了日時ちょうど", "2026-09-01T11:00:00+09:00", false],
      ["終了後", "2026-10-16T12:00:00+09:00", false],
    ])("%s（%s）なら %s", (_label, nowText, expected) => {
      // 準備
      const now = new Date(nowText);

      // 実行
      const running = isEventRunning(PERIOD, now);

      // 検証
      expect(running).toBe(expected);
    });
  });

  describe("終了日時が null（未定）のとき", () => {
    it("開始日時を過ぎていれば、どれだけ後でも開催中", () => {
      // 準備
      const now = new Date("2027-12-31T23:59:59+09:00");

      // 実行・検証
      expect(isEventRunning(OPEN_ENDED, now)).toBe(true);
    });

    it("開始日時ちょうどなら開催中", () => {
      // 準備
      const now = new Date("2026-08-07T12:00:00+09:00");

      // 実行・検証
      expect(isEventRunning(OPEN_ENDED, now)).toBe(true);
    });

    it("開始前なら開催中ではない", () => {
      // 準備
      const now = new Date("2026-08-07T11:59:59+09:00");

      // 実行・検証
      expect(isEventRunning(OPEN_ENDED, now)).toBe(false);
    });
  });

  describe("日時の書き方", () => {
    it("時差の書き方が違っても、同じ瞬間として比べる（日本時間の終了日時と UTC の今）", () => {
      // 準備：2026-09-01 11:00（日本時間）＝ 2026-09-01 02:00（UTC）
      const justBeforeEnd = new Date("2026-09-01T01:59:59Z");
      const justAtEnd = new Date("2026-09-01T02:00:00Z");

      // 実行・検証
      expect(isEventRunning(PERIOD, justBeforeEnd)).toBe(true);
      expect(isEventRunning(PERIOD, justAtEnd)).toBe(false);
    });

    it("秒を省いた日時（検証で認めている形）も読める", () => {
      // 準備
      const period: EventPeriod = {
        startAt: "2026-08-07T12:00+09:00",
        endAt: "2026-09-01T11:00+09:00",
      };

      // 実行・検証
      expect(isEventRunning(period, new Date("2026-08-07T11:59:00+09:00"))).toBe(false);
      expect(isEventRunning(period, new Date("2026-08-07T12:00:00+09:00"))).toBe(true);
      expect(isEventRunning(period, new Date("2026-09-01T11:00:00+09:00"))).toBe(false);
    });
  });

  it("テスト用の 2026夏イベ（2026-08-07 12:00 開始・終了日時は未定）は、2026-10-16 の時点で開催中", () => {
    // 準備：E2E（e2e/definition.spec.ts）の期待「開催中：2026夏イベ」の前提を確かめる
    const now = new Date("2026-10-16T12:00:00+09:00");

    // 実行・検証
    expect(isEventRunning(summer2026Definition.event, now)).toBe(true);
  });
});

describe("イベントの段階（eventPhase）", () => {
  it.each([
    ["開始前（開始の 1 秒前）", "2026-08-07T11:59:59+09:00", "upcoming"],
    ["開始日時ちょうど", "2026-08-07T12:00:00+09:00", "running"],
    ["終了の 1 秒前", "2026-09-01T10:59:59+09:00", "running"],
    ["終了日時ちょうど", "2026-09-01T11:00:00+09:00", "ended"],
    ["終了後", "2026-10-16T12:00:00+09:00", "ended"],
  ] as const)("終了日時があり、%s（%s）なら %s", (_label, nowText, expected) => {
    // 準備
    const now = new Date(nowText);

    // 実行
    const phase = eventPhase(PERIOD, now);

    // 検証
    expect(phase).toBe(expected);
  });

  it.each([
    ["開始前", "2026-08-07T11:59:59+09:00", "upcoming"],
    ["開始後（どれだけ後でも）", "2027-12-31T23:59:59+09:00", "running"],
  ] as const)("終了日時が未定（null）で、%s（%s）なら %s（終了にはならない）", (_label, nowText, expected) => {
    // 準備
    const now = new Date(nowText);

    // 実行
    const phase = eventPhase(OPEN_ENDED, now);

    // 検証
    expect(phase).toBe(expected);
  });
});

describe("次の境目（nextEventBoundary）", () => {
  it.each([
    ["開始前なら開始日時", "2026-08-07T11:59:59+09:00", "2026-08-07T12:00:00+09:00"],
    ["開始日時ちょうど（開催中）なら終了日時", "2026-08-07T12:00:00+09:00", "2026-09-01T11:00:00+09:00"],
    ["開催中なら終了日時", "2026-08-20T21:00:00+09:00", "2026-09-01T11:00:00+09:00"],
  ])("終了日時があり、%s（%s）", (_label, nowText, expected) => {
    // 準備
    const now = new Date(nowText);

    // 実行
    const boundary = nextEventBoundary(PERIOD, now);

    // 検証
    expect(boundary?.getTime()).toBe(new Date(expected).getTime());
  });

  it.each([
    ["終了日時ちょうど", "2026-09-01T11:00:00+09:00"],
    ["終了後", "2026-10-16T12:00:00+09:00"],
  ])("終了日時があり、%s（%s）なら、もう境目はない（null）", (_label, nowText) => {
    // 準備
    const now = new Date(nowText);

    // 実行・検証
    expect(nextEventBoundary(PERIOD, now)).toBeNull();
  });

  it("終了日時が未定（null）なら、開始前は開始日時、開始後は境目なし（null）", () => {
    // 準備
    const beforeStart = new Date("2026-08-07T11:59:59+09:00");
    const afterStart = new Date("2026-08-07T12:00:00+09:00");

    // 実行・検証
    expect(nextEventBoundary(OPEN_ENDED, beforeStart)?.getTime()).toBe(
      new Date("2026-08-07T12:00:00+09:00").getTime(),
    );
    expect(nextEventBoundary(OPEN_ENDED, afterStart)).toBeNull();
  });
});
