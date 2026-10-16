// 画面モード（ダーク／ライト／端末に合わせる）の切り替えの入口。保存（このブラウザへの記録）は PR-08 で足す

/** 画面モード。"system" は端末の設定（prefers-color-scheme）に合わせる */
export type ThemeMode = "dark" | "light" | "system";

/**
 * 今の画面モードを返す（PR-08 の設定ウィンドウで、選ばれている項目の表示に使う）。
 *
 * TODO(PR-03 実装)：空の入れ物
 */
export function useThemeMode(): ThemeMode {
  throw new Error("未実装：useThemeMode（PR-03 で実装する）");
}

/**
 * 画面モードを切り替える。`<ThemeSync />` が置かれていれば `<html data-theme>` に反映される。
 * - "dark" → data-theme="dark"
 * - "light" → data-theme="light"
 * - "system" → data-theme を付けない（theme.css が端末の設定に従う）
 *
 * TODO(PR-03 実装)：空の入れ物。いまは何もしない
 */
export function setThemeMode(mode: ThemeMode): void {
  void mode;
}
