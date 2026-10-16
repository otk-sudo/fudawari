// 保存した設定を起動時に戻す部品（SettingsSync）と、レイアウトへの差し込み（roadmap T2-12、要件 3.6）のテスト
//
// - SettingsSync はレイアウトに 1 つだけ置き、何も描画しない。起動時に getPlanStorage().loadSettings() で保存した設定を読み、
//   画面モードを setThemeMode で戻す（ThemeSync が <html data-theme> に反映する）。設定のウィンドウを開かなくても戻す。
// - レイアウト（src/app/layout.tsx）は、設定のウィンドウの枠に中身を差し込み（<SettingsDialog><SettingsContent /></SettingsDialog>）、
//   SettingsSync を置く。
import { cleanup, render, waitFor } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SettingsContent, SettingsSync } from "@/features/settings";
import { DEFAULT_THEME_MODE, setThemeMode, ThemeSync } from "@/features/theme";
import { resetPlanDataCache } from "@/lib/plan";
import type { FudawariStorage } from "@/lib/storage";
import { cleanupTestStorages, openTestStorage } from "@/test/plan-storage";

const html = document.documentElement;

/** このテストの保存先（beforeEach で開いて、共有の札割りのデータに渡す） */
let storage: FudawariStorage;

beforeEach(() => {
  storage = openTestStorage("fudawari-settings-sync-test").storage;
  resetPlanDataCache({ storage });
  setThemeMode(DEFAULT_THEME_MODE);
});

afterEach(async () => {
  cleanup();
  setThemeMode(DEFAULT_THEME_MODE);
  html.removeAttribute("data-theme");
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
