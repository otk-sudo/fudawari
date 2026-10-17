// 画面モード・文字の大きさの控え（localStorage）と、描画前に控えを読むスクリプト（DISPLAY_BOOT_SCRIPT）のテスト
// （要件 3.6、roadmap T2-12、PR-08 のレビュー M2）
//
// - DISPLAY_BOOT_SCRIPT はレイアウトの <head> にそのまま置く文字のスクリプト。ここでは jsdom の上でそのまま実行し、
//   控えの値から <html> の属性（data-theme・data-font-size）が付くことを確かめる
// - 控えのキーは THEME_MIRROR_KEY・FONT_SIZE_MIRROR_KEY（書く側と読む側で同じキーを使うことも、ここで確かめる）
// - localStorage が使えない（プライベートブラウズ・保存の拒否など）ときは、例外を外に出さず、属性を変えない
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_BOOT_SCRIPT,
  FONT_SIZE_MIRROR_KEY,
  readMirroredFontSize,
  readMirroredThemeMode,
  THEME_MIRROR_KEY,
  writeMirroredFontSize,
  writeMirroredThemeMode,
} from "./display-mirror";

const html = document.documentElement;

/** レイアウトが書き出す <html> の初期の属性（画面モードの初期値のダーク。文字の大きさの属性はない） */
function resetHtmlToLayoutDefault(): void {
  html.setAttribute("data-theme", "dark");
  html.removeAttribute("data-font-size");
}

/** <head> のスクリプトを、ブラウザが読み込んだときと同じように実行する */
function runBootScript(): void {
  // 文字のスクリプトをそのまま関数にして呼ぶ（<script> の中身と同じ扱い）
  new Function(DISPLAY_BOOT_SCRIPT)();
}

/** localStorage を使えなくする（読むのも書くのも例外を投げる）。afterEach の vi.restoreAllMocks() で戻る */
function makeLocalStorageUnavailable(): void {
  vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("localStorage は使えません（テスト）", "SecurityError");
  });
}

beforeEach(() => {
  localStorage.clear();
  resetHtmlToLayoutDefault();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetHtmlToLayoutDefault();
});

describe("描画前に控えを読むスクリプト（DISPLAY_BOOT_SCRIPT）", () => {
  it.each(["light", "dark"] as const)("画面モードの控えが %s なら data-theme をその値にする", (mode) => {
    // 準備
    html.setAttribute("data-theme", mode === "dark" ? "light" : "dark");
    localStorage.setItem(THEME_MIRROR_KEY, mode);

    // 実行
    runBootScript();

    // 検証
    expect(html).toHaveAttribute("data-theme", mode);
  });

  it("画面モードの控えが system（端末に合わせる）なら data-theme を外す（theme.css が端末の設定に従う）", () => {
    // 準備
    localStorage.setItem(THEME_MIRROR_KEY, "system");

    // 実行
    runBootScript();

    // 検証
    expect(html).not.toHaveAttribute("data-theme");
  });

  it.each(["small", "mid", "large"] as const)("文字の大きさの控えが %s なら data-font-size をその値にする", (fontSize) => {
    // 準備
    localStorage.setItem(FONT_SIZE_MIRROR_KEY, fontSize);

    // 実行
    runBootScript();

    // 検証
    expect(html).toHaveAttribute("data-font-size", fontSize);
  });

  it("画面モードと文字の大きさの控えを、両方とも付ける（ライト・大）", () => {
    // 準備
    localStorage.setItem(THEME_MIRROR_KEY, "light");
    localStorage.setItem(FONT_SIZE_MIRROR_KEY, "large");

    // 実行
    runBootScript();

    // 検証
    expect(html).toHaveAttribute("data-theme", "light");
    expect(html).toHaveAttribute("data-font-size", "large");
  });

  it("控えがなければ、レイアウトが書き出した属性のまま（data-theme=dark、data-font-size なし）", () => {
    // 準備：控えなし

    // 実行
    runBootScript();

    // 検証
    expect(html).toHaveAttribute("data-theme", "dark");
    expect(html).not.toHaveAttribute("data-font-size");
  });

  it.each([
    ["知らない値", "blue", "huge"],
    ["大文字の違い", "Light", "LARGE"],
    ["空の文字", "", ""],
    ["Object の既定の名前", "toString", "constructor"],
  ])("控えが%sなら無視して、属性を変えない", (_label, theme, fontSize) => {
    // 準備
    localStorage.setItem(THEME_MIRROR_KEY, theme);
    localStorage.setItem(FONT_SIZE_MIRROR_KEY, fontSize);

    // 実行
    runBootScript();

    // 検証
    expect(html).toHaveAttribute("data-theme", "dark");
    expect(html).not.toHaveAttribute("data-font-size");
  });

  it("localStorage が例外を投げても止まらず（例外を外に出さず）、属性を変えない", () => {
    // 準備
    makeLocalStorageUnavailable();

    // 実行・検証
    expect(() => runBootScript()).not.toThrow();
    expect(html).toHaveAttribute("data-theme", "dark");
    expect(html).not.toHaveAttribute("data-font-size");
  });
});

describe("控えの読み書き（readMirrored*／writeMirrored*）", () => {
  it("書いた画面モード・文字の大きさを、そのまま読める（書く側と描画前のスクリプトが同じキーを使う）", () => {
    // 準備・実行
    writeMirroredThemeMode("system");
    writeMirroredFontSize("small");

    // 検証：読む関数
    expect(readMirroredThemeMode()).toBe("system");
    expect(readMirroredFontSize()).toBe("small");
    // 検証：描画前のスクリプトも同じ控えを読む
    runBootScript();
    expect(html).not.toHaveAttribute("data-theme");
    expect(html).toHaveAttribute("data-font-size", "small");
  });

  it("控えがなければ null を返す", () => {
    // 準備：控えなし

    // 実行・検証
    expect(readMirroredThemeMode()).toBeNull();
    expect(readMirroredFontSize()).toBeNull();
  });

  it("控えが知らない値・Object の既定の名前なら null を返す", () => {
    // 準備
    localStorage.setItem(THEME_MIRROR_KEY, "toString");
    localStorage.setItem(FONT_SIZE_MIRROR_KEY, "huge");

    // 実行・検証
    expect(readMirroredThemeMode()).toBeNull();
    expect(readMirroredFontSize()).toBeNull();
  });

  it("localStorage が例外を投げるとき、読むと null を返し、書いても例外を外に出さない", () => {
    // 準備
    makeLocalStorageUnavailable();

    // 実行・検証
    expect(readMirroredThemeMode()).toBeNull();
    expect(readMirroredFontSize()).toBeNull();
    expect(() => writeMirroredThemeMode("light")).not.toThrow();
    expect(() => writeMirroredFontSize("large")).not.toThrow();
  });

  it("書き込みだけが失敗する（容量の上限など）ときも、例外を外に出さない", () => {
    // 準備
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("容量の上限（テスト）", "QuotaExceededError");
    });

    // 実行・検証
    expect(() => writeMirroredThemeMode("light")).not.toThrow();
    expect(() => writeMirroredFontSize("large")).not.toThrow();
    expect(readMirroredThemeMode()).toBeNull();
  });
});
