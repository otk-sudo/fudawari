// 保存した設定を起動時に戻す部品（SettingsSync）と、レイアウトへの差し込み（roadmap T2-12、要件 3.6）のテスト
//
// - SettingsSync はレイアウトに 1 つだけ置き、何も描画しない。起動時に getPlanStorage().loadSettings() で保存した設定を読み、
//   画面モードを setThemeMode で戻す（ThemeSync が <html data-theme> に反映する）。設定のウィンドウを開かなくても戻す。
// - レイアウト（src/app/layout.tsx）は、設定のウィンドウの枠に中身を差し込み（<SettingsDialog><SettingsContent /></SettingsDialog>）、
//   SettingsSync を置く。
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SettingsContent, SettingsSync } from "@/features/settings";
import { DEFAULT_THEME_MODE, setThemeMode, ThemeSync } from "@/features/theme";
import { resetPlanDataCache } from "@/lib/plan";
import type { FudawariStorage, Settings } from "@/lib/storage";
import { cleanupTestStorages, openTestStorage } from "@/test/plan-storage";
import { createDeferred } from "@/test/deferred";
import { FONT_SIZE_MIRROR_KEY, THEME_MIRROR_KEY } from "./display-mirror";
import { chooseFontSize, chooseThemeMode, restoreFontSize } from "./display-store";

// レイアウト（src/app/layout.tsx）は next/font（Noto_Sans_JP）を呼ぶ。next/font はビルドの変換が前提で、Vitest ではそのまま
// 呼べない（「Noto_Sans_JP is not a function」で読み込みに失敗する）ため、CSS 変数の名前だけを返す偽物に差し替える
vi.mock("next/font/google", () => ({
  Noto_Sans_JP: () => ({ className: "", variable: "font-noto-sans-jp-test", style: { fontFamily: "Noto Sans JP" } }),
}));

const html = document.documentElement;

/** このテストの保存先（beforeEach で開いて、共有の札割りのデータに渡す） */
let storage: FudawariStorage;

beforeEach(() => {
  localStorage.clear();
  storage = openTestStorage("fudawari-settings-sync-test").storage;
  resetPlanDataCache({ storage });
  setThemeMode(DEFAULT_THEME_MODE);
});

afterEach(async () => {
  cleanup();
  setThemeMode(DEFAULT_THEME_MODE);
  html.removeAttribute("data-theme");
  // 文字の大きさの今の値（モジュールの状態）を標準に戻し、属性と控えを消す
  restoreFontSize("mid");
  html.removeAttribute("data-font-size");
  localStorage.clear();
  resetPlanDataCache();
  vi.restoreAllMocks();
  await cleanupTestStorages();
});

/** 起動したときのレイアウトの代わりに、画面モードを反映する部品と SettingsSync だけを描く */
function renderStartup(): void {
  render(
    <>
      <ThemeSync />
      <SettingsSync />
    </>,
  );
}

/** React の要素の木から、要素をすべて集める（props.children をたどる） */
function collectElements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child as ReactNode, out);
    return out;
  }
  if (isValidElement(node)) {
    out.push(node);
    collectElements((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

describe("保存した設定を起動時に戻す（SettingsSync）", () => {
  it("保存した画面モードがライトなら、設定のウィンドウを開かなくても起動時に data-theme=light にする", async () => {
    // 準備
    await storage.saveSettings({ themeMode: "light" });

    // 実行
    renderStartup();

    // 検証
    await waitFor(() => expect(html).toHaveAttribute("data-theme", "light"));
  });

  it("保存した画面モードが「端末に合わせる」なら、起動時に data-theme を外す（端末の設定に従う）", async () => {
    // 準備
    await storage.saveSettings({ themeMode: "system" });

    // 実行
    renderStartup();

    // 検証：ThemeSync が初期値（ダーク）で付けた data-theme を、保存した設定を読んだ後に外す
    await waitFor(() => expect(html).not.toHaveAttribute("data-theme"));
  });
});

describe("文字の大きさ・控え・読み込み中の選択（SettingsSync。PR-08 のレビュー M2）", () => {
  /** 保存した設定の初期値（src/lib/storage の初期値と同じ） */
  const DEFAULTS: Settings = { themeMode: "dark", fontSize: "mid", trayView: "dense", traySort: "class" };

  /** 保存した設定の読み込みを止めておく（resolve で読み終える）。afterEach の vi.restoreAllMocks() で戻る */
  function holdLoadSettings(): (settings: Settings) => void {
    const deferred = createDeferred<Settings>();
    vi.spyOn(storage, "loadSettings").mockReturnValue(deferred.promise);
    return (settings) => deferred.resolve(settings);
  }

  it("保存した文字の大きさが「大」なら、設定のウィンドウを開かなくても起動時に data-font-size=large にする", async () => {
    // 準備
    await storage.saveSettings({ fontSize: "large" });

    // 実行
    renderStartup();

    // 検証
    await waitFor(() => expect(html).toHaveAttribute("data-font-size", "large"));
  });

  it("保存した文字の大きさが「小」なら data-font-size=small にする", async () => {
    // 準備
    await storage.saveSettings({ fontSize: "small" });

    // 実行
    renderStartup();

    // 検証
    await waitFor(() => expect(html).toHaveAttribute("data-font-size", "small"));
  });

  it("保存した設定を読み終える前でも、控え（localStorage）の画面モード・文字の大きさを描画の前に戻す（ちらつきを防ぐ）", () => {
    // 準備：控えはライト・大。保存した設定の読み込みは終わらない
    localStorage.setItem(THEME_MIRROR_KEY, "light");
    localStorage.setItem(FONT_SIZE_MIRROR_KEY, "large");
    holdLoadSettings();

    // 実行
    renderStartup();

    // 検証：ThemeSync が初期値（ダーク）で書き換えても、控えの値になっている
    expect(html).toHaveAttribute("data-theme", "light");
    expect(html).toHaveAttribute("data-font-size", "large");
  });

  it("保存した設定を読み終えたら、画面モード・文字の大きさを控えに写す（読み終えるまでは控えを書き換えない）", async () => {
    // 準備：控えはなし。保存した設定（ライト・大）の読み込みを止めておく
    const finishLoad = holdLoadSettings();
    renderStartup();
    // 読み終える前は、初期値（ダーク・標準）で控えを書かない
    expect(localStorage.getItem(THEME_MIRROR_KEY)).toBeNull();
    expect(localStorage.getItem(FONT_SIZE_MIRROR_KEY)).toBeNull();

    // 実行
    await act(async () => {
      finishLoad({ ...DEFAULTS, themeMode: "light", fontSize: "large" });
    });

    // 検証
    await waitFor(() => expect(localStorage.getItem(THEME_MIRROR_KEY)).toBe("light"));
    expect(localStorage.getItem(FONT_SIZE_MIRROR_KEY)).toBe("large");
    expect(html).toHaveAttribute("data-theme", "light");
    expect(html).toHaveAttribute("data-font-size", "large");
  });

  it("読み終えた後に設定のウィンドウで選んだ値も、控えに写す", async () => {
    // 準備：保存した設定（初期値）を読み終える
    renderStartup();
    await waitFor(() => expect(localStorage.getItem(FONT_SIZE_MIRROR_KEY)).toBe("mid"));

    // 実行：設定のウィンドウで「端末に合わせる」「小」を選ぶ
    act(() => {
      chooseThemeMode("system");
      chooseFontSize("small");
    });

    // 検証
    await waitFor(() => expect(localStorage.getItem(FONT_SIZE_MIRROR_KEY)).toBe("small"));
    expect(localStorage.getItem(THEME_MIRROR_KEY)).toBe("system");
    expect(html).toHaveAttribute("data-font-size", "small");
    expect(html).not.toHaveAttribute("data-theme");
  });

  it("保存した設定を読んでいる間に設定のウィンドウで選んだら、読み終えても古い保存の値で上書きしない（選んだ値を控えに写す）", async () => {
    // 準備：保存した設定（ライト・大）の読み込みを止めておく
    const finishLoad = holdLoadSettings();
    renderStartup();

    // 実行：読み終える前に「端末に合わせる」「小」を選び、その後で古い保存の値（ライト・大）を読み終える
    act(() => {
      chooseThemeMode("system");
      chooseFontSize("small");
    });
    await act(async () => {
      finishLoad({ ...DEFAULTS, themeMode: "light", fontSize: "large" });
    });

    // 検証：選んだ値のまま
    await waitFor(() => expect(localStorage.getItem(FONT_SIZE_MIRROR_KEY)).toBe("small"));
    expect(localStorage.getItem(THEME_MIRROR_KEY)).toBe("system");
    expect(html).toHaveAttribute("data-font-size", "small");
    expect(html).not.toHaveAttribute("data-theme");
  });

  it("保存した設定を読めなくても、控えの値のまま進める（例外を外に出さない）", async () => {
    // 準備：控えはライト・小。保存した設定は読めない
    localStorage.setItem(THEME_MIRROR_KEY, "light");
    localStorage.setItem(FONT_SIZE_MIRROR_KEY, "small");
    vi.spyOn(storage, "loadSettings").mockRejectedValue(new Error("読めない（テスト）"));

    // 実行
    renderStartup();

    // 検証
    await waitFor(() => expect(storage.loadSettings).toHaveBeenCalled());
    await act(async () => {});
    expect(html).toHaveAttribute("data-theme", "light");
    expect(html).toHaveAttribute("data-font-size", "small");
    expect(localStorage.getItem(FONT_SIZE_MIRROR_KEY)).toBe("small");
  });
});

describe("レイアウトへの差し込み（src/app/layout.tsx）", () => {
  it("設定のウィンドウの枠に中身（SettingsContent）を差し込み、SettingsSync を置く", () => {
    // 準備・実行：レイアウトが返す要素の木を集める（描画はしない）
    const elements = collectElements(RootLayout({ children: null }));

    // 検証
    const dialog = elements.find((element) => element.type === SettingsDialog);
    expect(dialog, "レイアウトに SettingsDialog があること").toBeDefined();
    const inside = collectElements((dialog?.props as { children?: ReactNode } | undefined)?.children);
    expect(
      inside.some((element) => element.type === SettingsContent),
      "SettingsDialog の children に SettingsContent があること",
    ).toBe(true);
    expect(
      elements.some((element) => element.type === SettingsSync),
      "レイアウトに SettingsSync があること",
    ).toBe(true);
  });
});
