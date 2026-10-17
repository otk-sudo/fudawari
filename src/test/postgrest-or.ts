// 偽物の PostgREST（src/test/supabase-fake.ts の FakeQuery.or と、src/test/permissions-e2e.ts の問い合わせ文字列 or=）で使う、
// or の絞り込みの読み方（PR-14：保存の記録の読み取りをキー〔created_at・id の新しい順〕で続きを読む形にするためのテストの準備）
//
// 読める形（PostgREST の論理の木の一部だけ）
// - "条件,条件,…"（どれかに合えばよい。or の中身。前後の括弧は付けても付けなくてもよい）
// - 条件：「列.演算子.値」または「and(条件,条件,…)」「or(条件,条件,…)」
// - 演算子：eq・neq・lt・lte・gt・gte
// - 値は二重引用符で囲んでもよい（"2026-10-15T13:52:00+00:00" のように . や : を含む値）
// 比べ方：行の値が数なら値を数にして比べる。両方が日時（YYYY-MM-DDTHH… の形）なら時刻で比べる（時差の書き方が違っても同じ時刻なら等しい）。
// ほかは文字列で比べる。
// Playwright からも読むので、Vitest や別名（@/…）を読み込まない。

/** 表の行 */
type Row = Record<string, unknown>;

type Operator = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";

const OPERATORS: ReadonlySet<string> = new Set(["eq", "neq", "lt", "lte", "gt", "gte"]);

/** 日時の形（PostgREST の timestamptz の文字） */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

/** 括弧と二重引用符の外にある , で分ける */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (!quoted && depth === 0 && char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** a と b を比べる（a が小さければ負、等しければ 0、大きければ正） */
function compare(rowValue: unknown, text: string): number {
  if (typeof rowValue === "number") return rowValue - Number(text);
  const left = String(rowValue);
  if (DATE_TIME.test(left) && DATE_TIME.test(text)) {
    const difference = Date.parse(left) - Date.parse(text);
    if (!Number.isNaN(difference)) return difference;
  }
  return left < text ? -1 : left > text ? 1 : 0;
}

function test(operator: Operator, compared: number): boolean {
  switch (operator) {
    case "eq":
      return compared === 0;
    case "neq":
      return compared !== 0;
    case "lt":
      return compared < 0;
    case "lte":
      return compared <= 0;
    case "gt":
      return compared > 0;
    case "gte":
      return compared >= 0;
  }
}

/** 条件 1 つ（列.演算子.値、and(…)、or(…)）が行に合うか */
function matchesCondition(row: Row, condition: string): boolean {
  const group = /^(and|or)\(([\s\S]*)\)$/.exec(condition);
  if (group !== null) {
    const children = splitTopLevel(group[2] ?? "");
    return group[1] === "and"
      ? children.every((child) => matchesCondition(row, child))
      : children.some((child) => matchesCondition(row, child));
  }
  const first = condition.indexOf(".");
  const second = condition.indexOf(".", first + 1);
  const column = condition.slice(0, first);
  const operator = condition.slice(first + 1, second);
  if (first <= 0 || second < 0 || !OPERATORS.has(operator)) {
    throw new Error(`偽物の PostgREST が知らない or の条件です：${condition}`);
  }
  const value = condition.slice(second + 1).replace(/^"([\s\S]*)"$/, "$1");
  if (row[column] === null || row[column] === undefined) return false;
  return test(operator as Operator, compare(row[column], value));
}

/** or の中身（"条件,条件"。前後の括弧があってもよい）が行に合うか（どれか 1 つに合えばよい） */
export function matchesPostgrestOr(row: Row, filters: string): boolean {
  const trimmed = filters.trim();
  const inner = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
  return splitTopLevel(inner).some((condition) => matchesCondition(row, condition));
}
