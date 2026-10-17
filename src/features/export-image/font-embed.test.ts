// 画像に埋め込む日本語フォントの CSS（font-embed.ts。要件 3.9：Noto Sans JP の必要な文字）のテスト
//
// jsdom の CSSOM は @font-face の src・unicode-range を読めないため、CSSFontFaceRule・CSSGroupingRule・
// document.styleSheets・fetch を偽物に差し替える（どれもブラウザの機能との境界）。
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { embeddedFontCss, familyNamesOf, parseUnicodeRange } from "@/features/export-image/font-embed";

// ---- 偽物 ----

/** @font-face の偽物（style.getPropertyValue で記述子を返す） */
class FakeFontFaceRule {
  readonly style: { getPropertyValue: (name: string) => string };
  readonly parentStyleSheet: { href: string | null };

  constructor(descriptors: Record<string, string>, href: string | null) {
    this.style = { getPropertyValue: (name) => descriptors[name] ?? "" };
    this.parentStyleSheet = { href };
  }
}

/** 中に規則を持つ規則（@media など）の偽物 */
class FakeGroupingRule {
  constructor(readonly cssRules: unknown[]) {}
}

/** スタイルシートの偽物（cssRules を読むと例外になるもの〔ほかのサイトのスタイルシート〕も作れる） */
function sheet(rules: unknown[] | "unreadable"): object {
  return {
    get cssRules(): unknown[] {
      if (rules === "unreadable") throw new DOMException("読めません", "SecurityError");
      return rules;
    },
  };
}

/** スタイルシートの href（相対の URL はここから解決する） */
const SHEET_HREF = "http://localhost:3000/_next/static/chunks/fonts.css";

/** Noto Sans JP の @font-face の偽物 */
function notoFace(file: string, unicodeRange: string): FakeFontFaceRule {
  return new FakeFontFaceRule(
    {
      "font-family": '"Noto Sans JP"',
      src: `url("/_next/static/media/${file}") format("woff2")`,
      "font-weight": "100 900",
      "font-display": "swap",
      "unicode-range": unicodeRange,
    },
    SHEET_HREF,
  );
}

let fetchMock: Mock<(url: string) => Promise<unknown>>;
/** 取得できない（404 になる）フォントのファイル名 */
let missingFiles: Set<string>;

beforeEach(() => {
  vi.stubGlobal("CSSFontFaceRule", FakeFontFaceRule);
  vi.stubGlobal("CSSGroupingRule", FakeGroupingRule);
  missingFiles = new Set();
  // 応答の本文は jsdom の Blob で返す（FileReader が jsdom の Blob だけを読むため）
  fetchMock = vi.fn(async (url: string) => {
    const file = url.split("/").pop() ?? "";
    if (missingFiles.has(file)) return { ok: false, status: 404, blob: async () => new Blob([]) };
    return { ok: true, status: 200, blob: async () => new Blob([file], { type: "font/woff2" }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  Reflect.deleteProperty(document, "styleSheets");
  vi.unstubAllGlobals();
});

/** document.styleSheets を偽物にする（afterEach で元に戻す） */
function useStyleSheets(sheets: object[]): void {
  Object.defineProperty(document, "styleSheets", { configurable: true, get: () => sheets });
}

/** data URL（"data:font/woff2;base64,…"）の中身の文字 */
function dataUrlTextOf(css: string, file: string): boolean {
  return css.includes(`data:font/woff2;base64,${btoa(file)}`);
}

// ---- テスト ----

describe("unicode-range を読む（parseUnicodeRange）", () => {
  it.each<[string, string, [number, number][]]>([
    ["? の範囲", "U+30??", [[0x3000, 0x30ff]]],
    ["- の範囲", "U+4E00-4E3F", [[0x4e00, 0x4e3f]]],
    ["1 文字", "U+5000", [[0x5000, 0x5000]]],
    ["小文字の u と 16 進", "u+0041-005a", [[0x41, 0x5a]]],
    ["並べたもの（前後の空白は無視）", " U+3000-303F,U+30??, U+5000 ", [[0x3000, 0x303f], [0x3000, 0x30ff], [0x5000, 0x5000]]],
    ["読めない値は飛ばす", "U+XYZ, U+0041, U+", [[0x41, 0x41]]],
    ["空", "", []],
  ])("%s：%s", (_label, value, expected) => {
    // 準備・実行・検証
    expect(parseUnicodeRange(value)).toEqual(expected);
  });
});

describe("フォントの指定の名前（familyNamesOf）", () => {
  it.each<[string, string[]]>([
    ["'Noto Sans JP', 'Noto Sans JP Fallback'", ["Noto Sans JP", "Noto Sans JP Fallback"]],
    ['"Noto Sans JP",Arial , sans-serif', ["Noto Sans JP", "Arial", "sans-serif"]],
    ["", []],
    ["  ", []],
  ])("%j → %j", (value, expected) => {
    // 準備・実行・検証
    expect(familyNamesOf(value)).toEqual(expected);
  });
});

describe("画像に埋め込むフォントの CSS（embeddedFontCss）", () => {
  it("名前が合い、文字を含む範囲の @font-face だけを、ファイルを data URL にして返す（記述子は写す。URL はスタイルシートの場所から解決する）", async () => {
    // 準備：「あ」は U+3042、「A」は U+0041
    useStyleSheets([
      sheet([
        notoFace("hiragana.woff2", "U+3040-309F"),
        notoFace("kanji.woff2", "U+4E00-4E3F"),
        notoFace("latin.woff2", "U+0000-00FF"),
      ]),
    ]);

    // 実行
    const css = await embeddedFontCss(["Noto Sans JP"], "あA");

    // 検証
    expect(css).not.toBeNull();
    const text = css ?? "";
    expect(dataUrlTextOf(text, "hiragana.woff2")).toBe(true);
    expect(dataUrlTextOf(text, "latin.woff2")).toBe(true);
    expect(dataUrlTextOf(text, "kanji.woff2")).toBe(false);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      "http://localhost:3000/_next/static/media/hiragana.woff2",
      "http://localhost:3000/_next/static/media/latin.woff2",
    ]);
    expect(text.match(/@font-face/g)).toHaveLength(2);
    expect(text).toContain('font-family: "Noto Sans JP";');
    expect(text).toContain("font-weight: 100 900;");
    expect(text).toContain("unicode-range: U+3040-309F;");
    expect(text).toContain('format("woff2")');
    expect(text).not.toContain("/_next/static/media/");
  });

  it("unicode-range のない @font-face は文字によらず入れ、名前が違うもの・src が local() だけのもの（代わりのフォント）は入れない", async () => {
    // 準備
    useStyleSheets([
      sheet([
        new FakeFontFaceRule({ "font-family": "'Noto Sans JP'", src: "url(all.woff2)" }, SHEET_HREF),
        new FakeFontFaceRule({ "font-family": "Other", src: "url(other.woff2)" }, SHEET_HREF),
        new FakeFontFaceRule({ "font-family": "'Noto Sans JP Fallback'", src: "local(Arial)" }, SHEET_HREF),
      ]),
    ]);

    // 実行
    const css = (await embeddedFontCss(["Noto Sans JP", "Noto Sans JP Fallback"], "あ")) ?? "";

    // 検証：url(all.woff2) はスタイルシートと同じ場所から取得する
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://localhost:3000/_next/static/chunks/all.woff2"]);
    expect(dataUrlTextOf(css, "all.woff2")).toBe(true);
    expect(css.match(/@font-face/g)).toHaveLength(1);
  });

  it("@media などの中の @font-face も探し、読めないスタイルシート（ほかのサイトのもの）は飛ばす", async () => {
    // 準備
    useStyleSheets([sheet("unreadable"), sheet([new FakeGroupingRule([notoFace("nested.woff2", "U+3040-309F")])])]);

    // 実行
    const css = (await embeddedFontCss(["Noto Sans JP"], "あ")) ?? "";

    // 検証
    expect(dataUrlTextOf(css, "nested.woff2")).toBe(true);
  });

  it("当てはまる @font-face がなければ null（既定の埋め込みに任せる）", async () => {
    // 準備
    useStyleSheets([sheet([notoFace("kanji2.woff2", "U+4E00-4E3F")])]);

    // 実行・検証
    expect(await embeddedFontCss(["Noto Sans JP"], "あ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("取得できなかったファイルの分は入れずに、取得できた分だけを返す。1 つも取得できなければ空の文字列", async () => {
    // 準備
    missingFiles = new Set(["missing-a.woff2", "missing-b.woff2"]);
    useStyleSheets([sheet([notoFace("found.woff2", "U+3040-309F"), notoFace("missing-a.woff2", "U+0000-00FF")])]);

    // 実行・検証：一部だけ取得できた
    const css = (await embeddedFontCss(["Noto Sans JP"], "あA")) ?? "";
    expect(dataUrlTextOf(css, "found.woff2")).toBe(true);
    expect(css.match(/@font-face/g)).toHaveLength(1);

    // 実行・検証：1 つも取得できない
    useStyleSheets([sheet([notoFace("missing-b.woff2", "U+3040-309F")])]);
    expect(await embeddedFontCss(["Noto Sans JP"], "あ")).toBe("");
  });
});
