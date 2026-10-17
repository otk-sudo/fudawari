// 画像（PNG）に埋め込む日本語フォントの CSS を作る（要件 3.9：Noto Sans JP の必要な文字）。ブラウザの機能との境界
//
// modern-screenshot は、そのままだとフォントの名前が合う @font-face をすべて埋め込む。Noto Sans JP は文字の範囲ごとに
// 120 ほどのファイル（合わせて 5MB 余り）に分かれているため、すべてを読み込んで埋め込むと、画像を作るのに時間がかかり、
// まだ読み込んでいないファイルまで取得してしまう。そこで、画像の文字を含む範囲（unicode-range）の @font-face だけを選び、
// フォントのファイルを data URL にした CSS を作って、modern-screenshot の font.cssText に渡す。

/** unicode-range の 1 つの範囲（両端を含む） */
type CodePointRange = readonly [start: number, end: number];

/** CSS の文字列の前後の引用符を外す（例 "'Noto Sans JP'" → "Noto Sans JP"） */
function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, "$2");
}

/** フォントの指定（例 "'Noto Sans JP', 'Noto Sans JP Fallback'"）の名前の一覧 */
export function familyNamesOf(fontFamily: string): string[] {
  return fontFamily
    .split(",")
    .map(unquote)
    .filter((name) => name !== "");
}

/** unicode-range の値（例 "U+4E00-4E3F, U+5000, U+30??"）の範囲の一覧。読めない部分は飛ばす */
export function parseUnicodeRange(value: string): CodePointRange[] {
  return value.split(",").flatMap((part): CodePointRange[] => {
    const token = part.trim().replace(/^u\+/i, "");
    if (token === "") return [];
    if (token.includes("?")) {
      const start = Number.parseInt(token.replaceAll("?", "0"), 16);
      const end = Number.parseInt(token.replaceAll("?", "F"), 16);
      return Number.isNaN(start) || Number.isNaN(end) ? [] : [[start, end]];
    }
    const [first, last = first] = token.split("-");
    const start = Number.parseInt(first, 16);
    const end = Number.parseInt(last, 16);
    return Number.isNaN(start) || Number.isNaN(end) ? [] : [[start, end]];
  });
}

/** 文字のどれかが範囲に入るか */
function coversAny(ranges: readonly CodePointRange[], codePoints: readonly number[]): boolean {
  return codePoints.some((code) => ranges.some(([start, end]) => code >= start && code <= end));
}

/** @font-face か（CSSFontFaceRule がない環境〔テストの jsdom など〕では false） */
function isFontFaceRule(rule: CSSRule): rule is CSSFontFaceRule {
  return typeof CSSFontFaceRule !== "undefined" && rule instanceof CSSFontFaceRule;
}

/** 中に規則を持つ規則（@media・@layer など）か */
function isGroupingRule(rule: CSSRule): rule is CSSGroupingRule {
  return typeof CSSGroupingRule !== "undefined" && rule instanceof CSSGroupingRule;
}

/** 文書のスタイルシートの @font-face（読めないスタイルシート〔ほかのサイトのもの〕は飛ばす） */
function fontFaceRules(): CSSFontFaceRule[] {
  const found: CSSFontFaceRule[] = [];
  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (isFontFaceRule(rule)) {
        found.push(rule);
      } else if (isGroupingRule(rule)) {
        visit(rule.cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    visit(rules);
  }
  return found;
}

/** url(...) の中身（最初の 1 つ）。なければ null */
function firstUrlOf(src: string): string | null {
  const match = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(src);
  return match === null ? null : match[2];
}

/** format(...) の中身（最初の 1 つ。例 "woff2"）。なければ null */
function firstFormatOf(src: string): string | null {
  const match = /format\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(src);
  return match === null ? null : match[2];
}

/** @font-face の src 以外で写す項目 */
const FONT_FACE_DESCRIPTORS: readonly string[] = [
  "font-family",
  "font-style",
  "font-weight",
  "font-stretch",
  "font-display",
  "unicode-range",
];

/** @font-face を、src を data URL にして書き直す */
function fontFaceCss(rule: CSSFontFaceRule, dataUrl: string): string {
  const descriptors = FONT_FACE_DESCRIPTORS.flatMap((name) => {
    const value = rule.style.getPropertyValue(name).trim();
    return value === "" ? [] : [`${name}: ${value};`];
  });
  const format = firstFormatOf(rule.style.getPropertyValue("src"));
  const src = `src: url("${dataUrl}")${format === null ? "" : ` format("${format}")`};`;
  return `@font-face { ${[...descriptors, src].join(" ")} }`;
}

/** Blob を data URL にする */
function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("フォントのファイルを読めませんでした"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("フォントのファイルを読めませんでした"));
    reader.readAsDataURL(blob);
  });
}

/** 取得したフォントのファイル（data URL）。同じファイルを画像ごとに取り直さないよう覚えておく */
const dataUrlCache = new Map<string, Promise<string>>();

/** フォントのファイルを取得して data URL にする（ブラウザのキャッシュにあればそれを使う） */
function fontDataUrl(url: string): Promise<string> {
  const cached = dataUrlCache.get(url);
  if (cached !== undefined) return cached;
  const loading = fetch(url, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`フォントのファイルを取得できませんでした（${response.status}）`);
      return response.blob();
    })
    .then(toDataUrl);
  // 失敗したものは覚えない（次に作るときに取り直す）
  loading.catch(() => dataUrlCache.delete(url));
  dataUrlCache.set(url, loading);
  return loading;
}

/**
 * 画像に埋め込むフォントの CSS（families の名前の @font-face のうち、text の文字を含む範囲のものだけ。
 * フォントのファイルは data URL にする）。
 * - 当てはまる @font-face がなければ null（modern-screenshot の既定の埋め込みに任せる）
 * - 取得できなかったファイルの分は入れない（取得できた分だけで描く）。1 つも取得できなければ空の文字列
 */
export async function embeddedFontCss(families: readonly string[], text: string): Promise<string | null> {
  const wanted = new Set(families);
  const codePoints = [...new Set(Array.from(text, (char) => char.codePointAt(0) ?? 0))];
  const rules = fontFaceRules().filter((rule) => {
    if (!wanted.has(unquote(rule.style.getPropertyValue("font-family")))) return false;
    if (firstUrlOf(rule.style.getPropertyValue("src")) === null) return false;
    const range = rule.style.getPropertyValue("unicode-range").trim();
    return range === "" || coversAny(parseUnicodeRange(range), codePoints);
  });
  if (rules.length === 0) return null;

  const results = await Promise.allSettled(
    rules.map(async (rule) => {
      const rawUrl = firstUrlOf(rule.style.getPropertyValue("src")) ?? "";
      const absoluteUrl = new URL(rawUrl, rule.parentStyleSheet?.href ?? document.baseURI).href;
      return fontFaceCss(rule, await fontDataUrl(absoluteUrl));
    }),
  );
  return results
    .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    .join("\n");
}
