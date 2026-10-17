import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 設定の「文字の大きさ」（要件 3.6、roadmap T2-12）の効く範囲を、CSS の文字列で確かめる（jsdom は var()・calc() の計算値を出さないため）
//
// 方針（PR-08 のレビュー B1・Codex P1 への対応）
// - 本文の大きさ --font-size-base は 13px のまま（rem にしない。:root の文字の大きさも変えない）。
//   こうすると、設定で「大」を選んでも、ホーム・取り込み・差分・定義などほかの画面の文字は変わらない
// - theme.css の :root に --font-scale を置く（標準 1）。<html data-font-size="small|large"> で 0.875・1.125 に切り替える
// - 一覧（src/features/list）と割り振り（src/features/assign：艦カード・控え・札の列など）の CSS の文字の大きさだけを
//   calc(Npx * var(--font-scale)) で書く
// - 画像で保存の画像（src/features/export-image）は対象外（画像の大きさを変えない）。ほかの画面の CSS も --font-scale を使わない

/** プロジェクトの根からのパス */
const ROOT = process.cwd();
const THEME_CSS = resolve(ROOT, "src/styles/theme.css");

/** 文字の大きさを --font-scale で変える画面の CSS のフォルダ（一覧・割り振り） */
const SCALED_DIRS = ["src/features/list", "src/features/assign"] as const;

/** 割り振りの画面の、必ず --font-scale で文字の大きさを変える部品の CSS（艦カード・控え・札の列） */
const ASSIGN_KEY_FILES = [
  "src/features/assign/ShipCard.module.css",
  "src/features/assign/TrayPanel.module.css",
  "src/features/assign/FudaColumn.module.css",
] as const;

/** CSS のコメントを除く */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** ファイルを読み、コメントを除いた CSS を返す */
function readCss(path: string): string {
  return stripComments(readFileSync(path, "utf8"));
}

/** フォルダの下（下のフォルダも含む）の .css ファイルの絶対パス */
function cssFilesUnder(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** プロジェクトの根からの相対パス（区切りは /。失敗の表示用） */
function rel(path: string): string {
  return relative(ROOT, path).split("\\").join("/");
}

/** 規則 1 つ（セレクタと中身） */
interface CssRule {
  readonly selector: string;
  readonly body: string;
}

/** 入れ子のない規則（`セレクタ { 中身 }`）を集める。@media の中の規則も、中の `セレクタ { … }` として拾う */
function rulesOf(css: string): CssRule[] {
  const rules: CssRule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

/** セレクタがちょうど selector の規則の中身をつないだもの */
function bodyOf(css: string, selector: string): string {
  return rulesOf(css)
    .filter((rule) => rule.selector === selector)
    .map((rule) => rule.body)
    .join("\n");
}

/** 中身の中の、名前が name の宣言の値（最後のもの。なければ null） */
function declarationValue(body: string, name: string): string | null {
  const escaped = name.replace(/[-]/g, "\\-");
  const values = [...body.matchAll(new RegExp(`(?<![\\w-])${escaped}\\s*:\\s*([^;]+);?`, "g"))].map((m) =>
    m[1].trim(),
  );
  return values.length === 0 ? null : values[values.length - 1];
}

/** CSS の中の font-size の宣言の値（--font-size-base などの変数は含めない） */
function fontSizeValues(css: string): string[] {
  return [...css.matchAll(/(?<![\w-])font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
}

/** 文字の大きさを --font-scale で変える書き方：calc(Npx * var(--font-scale))。inherit（親に従う）もよい */
const SCALED_FONT_SIZE = /^(?:calc\(\s*\d+(?:\.\d+)?px\s*\*\s*var\(\s*--font-scale\s*\)\s*\)|inherit)$/;

describe("文字の大きさの CSS 変数（src/styles/theme.css）", () => {
  it("本文の大きさ --font-size-base は 13px（rem にしない。設定の「文字の大きさ」でほかの画面の文字を変えない）", () => {
    // 準備
    const css = readCss(THEME_CSS);

    // 実行
    const value = declarationValue(bodyOf(css, ":root"), "--font-size-base");

    // 検証
    expect(value).toBe("13px");
  });

  it(":root に --font-scale の標準の値 1 を置く", () => {
    // 準備
    const css = readCss(THEME_CSS);

    // 実行
    const value = declarationValue(bodyOf(css, ":root"), "--font-scale");

    // 検証
    expect(value, ":root { --font-scale: 1; } があること").not.toBeNull();
    expect(Number(value)).toBe(1);
  });

  it.each([
    ["small", 0.875],
    ["large", 1.125],
  ])('<html data-font-size="%s"> では --font-scale を %s にする', (fontSize, expected) => {
    // 準備
    const css = readCss(THEME_CSS);

    // 実行
    const value = declarationValue(bodyOf(css, `:root[data-font-size="${fontSize}"]`), "--font-scale");

    // 検証
    expect(value, `:root[data-font-size="${fontSize}"] { --font-scale: ${expected}; } があること`).not.toBeNull();
    expect(Number(value)).toBe(expected);
  });

  it(":root の文字の大きさ（font-size）は変えない（data-font-size で rem の基準を変えると、ほかの画面の文字まで変わるため）", () => {
    // 準備
    const css = readCss(THEME_CSS);

    // 実行：theme.css は変数だけを置く。font-size の宣言（--font-size-base などの変数は除く）を集める
    const declarations = rulesOf(css)
      .filter((rule) => fontSizeValues(rule.body).length > 0)
      .map((rule) => `${rule.selector} { font-size: ${fontSizeValues(rule.body).join(", ")} }`);

    // 検証
    expect(declarations).toEqual([]);
  });
});

describe("一覧・割り振りの画面の文字の大きさ（--font-scale）", () => {
  it("一覧・割り振りの CSS の文字の大きさは、すべて calc(Npx * var(--font-scale)) で書く", () => {
    // 準備
    const files = SCALED_DIRS.flatMap((dir) => cssFilesUnder(dir));
    expect(files.length, "一覧・割り振りの CSS があること").toBeGreaterThan(0);

    // 実行：--font-scale を使っていない font-size の宣言を集める
    const unscaled = files.flatMap((file) =>
      fontSizeValues(readCss(file))
        .filter((value) => !SCALED_FONT_SIZE.test(value))
        .map((value) => `${rel(file)}: font-size: ${value}`),
    );

    // 検証
    expect(unscaled).toEqual([]);
  });

  it.each(ASSIGN_KEY_FILES)("割り振りの %s は、文字の大きさに --font-scale を使う", (file) => {
    // 準備
    const css = readCss(resolve(ROOT, file));

    // 実行
    const scaled = fontSizeValues(css).filter((value) => /var\(\s*--font-scale\s*\)/.test(value));

    // 検証
    expect(scaled.length).toBeGreaterThan(0);
  });

  it("ほかの画面・共通の部品・画像で保存の画像の CSS は --font-scale を使わない（設定の「文字の大きさ」はほかに効かない）", () => {
    // 準備：src の下の CSS から、一覧・割り振りと theme.css（変数を置く所）を除く
    const scaledRoots = SCALED_DIRS.map((dir) => resolve(ROOT, dir));
    const others = cssFilesUnder("src").filter(
      (file) => file !== THEME_CSS && !scaledRoots.some((dir) => file.startsWith(dir)),
    );
    expect(
      others.some((file) => rel(file).startsWith("src/features/export-image/")),
      "画像で保存の CSS を調べる対象に含めていること",
    ).toBe(true);

    // 実行
    const using = others.filter((file) => /--font-scale/.test(readCss(file))).map(rel);

    // 検証
    expect(using).toEqual([]);
  });
});
