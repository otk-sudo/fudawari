// 画面モード（ダーク／ライト／端末に合わせる）の切り替えの入口。保存（このブラウザへの記録）は PR-08 で足す
import { create } from "zustand";
import { DEFAULT_THEME_MODE, type ThemeMode } from "./theme-mode-base";

// 型と初期値は theme-mode-base.ts（React・zustand を読み込まない）に置き、ここからも読み込めるようにしておく
export { DEFAULT_THEME_MODE };
export type { ThemeMode };

/**
 * 画面モードに対応する `<html data-theme>` の値を返す。
 * "system" は属性を付けない（theme.css が端末の設定に従う）ので undefined。
 */
export function themeAttributeFor(mode: ThemeMode): "dark" | "light" | undefined {
  return mode === "system" ? undefined : mode;
}

type ThemeModeState = { mode: ThemeMode };

const useThemeModeStore = create<ThemeModeState>(() => ({
  mode: DEFAULT_THEME_MODE,
}));

/**
 * 今の画面モードを返す（PR-08 の設定ウィンドウで、選ばれている項目の表示に使う）。
 */
export function useThemeMode(): ThemeMode {
  return useThemeModeStore((state) => state.mode);
}

/**
 * 画面モードを切り替える。`<ThemeSync />` が置かれていれば `<html data-theme>` に反映される。
 * - "dark" → data-theme="dark"
 * - "light" → data-theme="light"
 * - "system" → data-theme を付けない（theme.css が端末の設定に従う）
 */
export function setThemeMode(mode: ThemeMode): void {
  useThemeModeStore.setState({ mode });
}
