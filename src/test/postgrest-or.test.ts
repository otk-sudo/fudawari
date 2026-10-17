import { describe, expect, it } from "vitest";
import { matchesPostgrestOr } from "./postgrest-or";

// 偽物の PostgREST の or の読み方（src/test/postgrest-or.ts。PR-14 のテストの準備）が、
// 保存の記録の続きを読む形（created_at.lt.X,and(created_at.eq.X,id.lt.Y)）を正しく読むことを確かめる

const X = "2026-10-15T13:52:00+00:00";
const FILTER = `created_at.lt.${X},and(created_at.eq.${X},id.lt.10)`;

describe("偽物の PostgREST の or（matchesPostgrestOr）", () => {
  it.each([
    ["より古い時刻", { created_at: "2026-10-15T13:51:59+00:00", id: 99 }, true],
    ["同じ時刻で id が小さい", { created_at: X, id: 9 }, true],
    ["同じ時刻で id が同じ", { created_at: X, id: 10 }, false],
    ["同じ時刻で id が大きい", { created_at: X, id: 11 }, false],
    ["より新しい時刻", { created_at: "2026-10-15T13:52:01+00:00", id: 1 }, false],
  ])("続きの条件：%s → %s", (_label, row, expected) => {
    expect(matchesPostgrestOr(row, FILTER)).toBe(expected);
    // 前後の括弧（問い合わせ文字列の or=(…)）と、二重引用符で囲んだ値でも同じ
    expect(matchesPostgrestOr(row, `(${FILTER})`)).toBe(expected);
    expect(matchesPostgrestOr(row, `created_at.lt."${X}",and(created_at.eq."${X}",id.lt.10)`)).toBe(expected);
  });

  it("時刻は時差の書き方が違っても同じ時刻として比べる（+09:00 と +00:00）", () => {
    expect(matchesPostgrestOr({ created_at: X, id: 5 }, "created_at.eq.2026-10-15T22:52:00+09:00")).toBe(true);
  });

  it("知らない演算子は例外にする（テストの書き間違いを早く見つける）", () => {
    expect(() => matchesPostgrestOr({ id: 1 }, "id.like.1")).toThrow(/知らない or の条件/);
  });
});
